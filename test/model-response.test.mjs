import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyModelResponse,
  finalLineImpulse,
  strictImpulse,
} from '../src/cognition.mjs';

test('only exact final text counts as a structured impulse', () => {
  const completed = {
    status: 'completed',
    output_text: 'migrate',
  };
  assert.equal(classifyModelResponse(completed, 200, 'responses'), 'valid');
  assert.equal(strictImpulse(completed, 'responses'), 'migrate');
});

test('reasoning summary without final text is not a structured impulse', () => {
  const incomplete = {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: [{
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'echo trace migrate sleep' }],
    }],
  };
  assert.equal(classifyModelResponse(incomplete, 200, 'responses'), 'incomplete_max_output_tokens');
  assert.equal(strictImpulse(incomplete, 'responses'), null);
});

test('extra words in final text are rejected', () => {
  const verbose = {
    status: 'completed',
    output_text: 'I choose migrate',
  };
  assert.equal(classifyModelResponse(verbose, 200, 'responses'), 'invalid_final_text');
  assert.equal(strictImpulse(verbose, 'responses'), null);
});

test('chat final text is trimmed and validated exactly', () => {
  const chat = { choices: [{ message: { content: ' trace \n' } }] };
  assert.equal(classifyModelResponse(chat, 200, 'chat'), 'valid');
  assert.equal(strictImpulse(chat, 'chat'), 'trace');
});

test('production final-line contract accepts one word on the last line', () => {
  const payload = {
    status: 'completed',
    output_text: 'A calm weather is noted.\n\nsleep',
  };
  assert.equal(finalLineImpulse(payload, 'responses'), 'sleep');
  assert.equal(strictImpulse(payload, 'responses'), null);
});

test('production final-line contract rejects extra text on the last line', () => {
  const payload = { status: 'completed', output_text: 'I choose migrate' };
  assert.equal(finalLineImpulse(payload, 'responses'), null);
});
