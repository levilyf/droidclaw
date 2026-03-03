'use strict';
const registry = require('./registry');
const state    = require('../core/state');

registry.register('add_goal', async ({ goal }) => {
  if (!goal) return 'error: goal text required';
  state.addGoal(goal);
  return `goal added: "${goal}"`;
}, 'add a goal for kira to work toward');

registry.register('complete_goal', async ({ goal }) => {
  if (!goal) return 'error: goal text required';
  state.completeGoal(goal);
  return `goal marked complete: "${goal}"`;
}, 'mark a goal as complete');

registry.register('list_goals', async () => {
  const goals = state.getActiveGoals();
  if (!goals.length) return 'no active goals.';
  return goals.map((g, i) => `${i + 1}. ${g.text}`).join('\n');
}, 'list active goals');

registry.register('update_world', async ({ key, value }) => {
  if (!key || !value) return 'error: key and value required';
  const s       = state.load();
  s.world       = s.world || {};
  s.world[key]  = value;
  state.save(s);
  return `world model updated: ${key} = ${value}`;
}, 'update world model with info about levi and his context');

module.exports = {};
