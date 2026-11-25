import {deepStrictEqual} from 'node:assert/strict';
import {test} from 'node:test';
import {
 defaultPresentationQuality,
 presentationCaptureQuality,
 readPresentationQuality
} from './presentation-quality.ts';

test('presentation settings keep the previous default and reject unsupported stored values', () => {
 deepStrictEqual(readPresentationQuality(undefined), defaultPresentationQuality);
 deepStrictEqual(readPresentationQuality({profile: 'broken', height: 4096, frameRate: 0}), defaultPresentationQuality);
});

test('presentation profiles resolve to capture limits without overwriting manual preferences', () => {
 const manual = {profile: 'custom', height: 480, frameRate: 24};
 deepStrictEqual(presentationCaptureQuality({...manual, profile: 'motion'}), {width: 1280, height: 720, frameRate: 30});
 deepStrictEqual(presentationCaptureQuality({...manual, profile: 'detail'}), {width: 1920, height: 1080, frameRate: 5});
 deepStrictEqual(presentationCaptureQuality(readPresentationQuality(manual)), {
  width: 854,
  height: 480,
  frameRate: 24
 });
});
