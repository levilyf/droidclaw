'use strict';
/**
 * Task Tools — Kira manages her own tasks via conversation
 */

const registry   = require('./registry');
const taskEngine = require('../task_engine');

registry.register('create_task', async ({ goal, schedule }, context) => {
  if (!goal) return 'error: goal required';

  const engine = require('../core/engine');
  const task   = await taskEngine.createTask(goal, schedule || 'every hour', engine);

  const next = task.next_run
    ? new Date(task.next_run).toLocaleString()
    : 'unknown';

  return `task created: "${goal}"\nsteps planned: ${task.steps?.length || 0}\nnext run: ${next}`;
}, 'create a new scheduled task from a goal description — goal: what to do, schedule: when (e.g. "every morning at 8am")');

registry.register('list_tasks', async () => {
  return taskEngine.formatTaskList();
}, 'list all scheduled tasks with their status and next run time');

registry.register('delete_task', async ({ name }) => {
  if (!name) return 'error: name or goal fragment required';
  const removed = taskEngine.removeTask(name);
  return removed ? `removed task matching: ${name}` : `no task found matching: ${name}`;
}, 'delete a task by name or goal fragment');

registry.register('pause_task', async ({ name }) => {
  if (!name) return 'error: name required';
  taskEngine.toggleTask(name, false);
  return `paused: ${name}`;
}, 'pause a scheduled task');

registry.register('resume_task', async ({ name }) => {
  if (!name) return 'error: name required';
  taskEngine.toggleTask(name, true);
  return `resumed: ${name}`;
}, 'resume a paused task');

registry.register('run_task_now', async ({ name }) => {
  if (!name) return 'error: name required';
  const tasks = taskEngine.listTasks();
  const task  = tasks.find(t => t.goal?.toLowerCase().includes(name.toLowerCase()));
  if (!task) return `no task found matching: ${name}`;

  const engine = require('../core/engine');
  const result = await taskEngine.executeTask(task, engine);
  const summary = await taskEngine.summarizeResult(task, result, engine);

  return summary || result.output || 'task executed';
}, 'run a scheduled task immediately right now');

module.exports = {};
