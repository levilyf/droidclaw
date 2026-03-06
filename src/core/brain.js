'use strict';

const emotion      = require('./emotion');
const episodic     = require('./episodic');
const sense        = require('./sense');
const learn        = require('./learn');
const semanticBrain = require('./semantic_brain');

let _emotionState = null;
let _lastQuery    = null;
let _sensorData   = null;

// called once at session start
function wakeUp() {
  // read phone sensors
  _sensorData   = sense.read();

  // load and update emotional state from sensors
  _emotionState = emotion.load();
  _emotionState = emotion.updateFromSensors(
    _emotionState,
    _sensorData.battery,
    _sensorData.temp,
    _sensorData.hour
  );
  emotion.save(_emotionState);
}

// called on every message
function pulse(message, role) {
  if (!_emotionState) wakeUp();
  _emotionState = emotion.update(_emotionState, message, role);
  emotion.save(_emotionState);

  // store emotionally significant user messages
  if (role === 'user' && message && message.length > 20) {
    const emotionScore = (_emotionState.tension + _emotionState.connection + _emotionState.focus) / 3;
    const importance   = message.length > 80 ? 0.7 : 0.4;

    if (emotionScore > 0.4 || importance > 0.5) {
      episodic.store(message, {
        importance,
        emotionScore,
        hadTension: _emotionState.tension > 0.4
      });
    }
  }
}

// build full brain context for soul.js injection
function getContext() {
  if (!_emotionState) wakeUp();

  const sections = [];

  // sensor / body state
  if (_sensorData) {
    sections.push(`## BODY STATE\n${sense.describe(_sensorData)}`);
  }

  // emotional state
  const emotionDesc = emotion.describe(_emotionState);
  if (emotionDesc) {
    sections.push(`## EMOTIONAL STATE\n${emotionDesc}`);
  }

  // episodic memory — top 5 relevant memories
  const memories = episodic.getContextSummary(_emotionState, 5);
  if (memories) {
    sections.push(`## RECENT MEMORIES (emotionally weighted)\n${memories}`);
  }

  // permanent knowledge
  const brainContext = semanticBrain.getContext(_lastQuery, _emotionState);
  if (brainContext) {
    sections.push(brainContext);
  }

  // learned behavioral rules
  const behaviors = learn.getBehavioralContext();
  if (behaviors) {
    sections.push(behaviors);
  }

  return sections.join('\n\n');
}

// called at session end
async function sleep(engine, conversationHistory) {
  if (!engine || !conversationHistory) return;

  try {
    // learn from this session
    await learn.learnFromSession(engine, conversationHistory);

    // distill into permanent brain
    const summary = conversationHistory.slice(-1500);
    await semanticBrain.updateLPM(engine, summary);
    await semanticBrain.consolidateScenes(engine, episodic.load().slice(-20));
  } catch {}
}

// expose emotion state for other modules
function getEmotionState() { return _emotionState; }
function getSensorData()   { return _sensorData; }

module.exports = { wakeUp, pulse, getContext, sleep, getEmotionState, getSensorData };
