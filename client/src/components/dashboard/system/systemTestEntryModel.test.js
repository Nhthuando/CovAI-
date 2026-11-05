import {test} from 'node:test';
import assert from 'node:assert/strict';
import {systemTestEntryState} from './systemTestEntryModel.js';
test('configuration alone does not unlock the dashboard; applied files do',()=>{
  assert.equal(systemTestEntryState({discovery:{hasSystemTests:true,totalFilesCount:0}}),'empty');
  assert.equal(systemTestEntryState({discovery:{totalFilesCount:1}}),'workspace');
  assert.equal(systemTestEntryState({discovery:{totalFilesCount:0},activeJob:true}),'workspace');
});
test('loading and failed discovery never claim the project has no tests',()=>{
  assert.equal(systemTestEntryState({}),'loading');
  assert.equal(systemTestEntryState({error:'Network unavailable'}),'error');
  assert.equal(systemTestEntryState({discovery:{totalFilesCount:0,errors:['Scan failed']}}),'error');
});
