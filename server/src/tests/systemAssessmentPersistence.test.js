import {it,expect,jest} from '@jest/globals';
await jest.unstable_mockModule('../config/prisma.js',()=>({default:{}}));
const {publishAppliedAssessment}=await import('../services/systemAssessmentPersistence.service.js');
it('publishes both independent runs and their matching candidate hashes atomically',async()=>{
    const tx={systemTestAssessment:{findUnique:jest.fn().mockResolvedValue(null),create:jest.fn().mockResolvedValue({id:'assessment'})},testRun:{create:jest.fn().mockResolvedValueOnce({id:'one'}).mockResolvedValueOnce({id:'two'})}};
    const client={$transaction:jest.fn(fn=>fn(tx))};
    const report={sourceHash:'source',testHash:'new-tests',scopeHash:'scope',runs:Array.from({length:2},()=>({testRun:{status:'PASSED',totalTests:7,passedTests:7,scenarios:[{title:'persistence',status:'passed',screenshotPath:'saved-evidence.png'}]},measurement:{status:'MEASURED'}}))};
    const options={client,job:{id:'job',snapshotId:'snapshot'},input:{runner:'playwright',executionMode:'full'},report,requirementRevisionId:null};
    await expect(publishAppliedAssessment(options)).resolves.toEqual({id:'assessment'});
    expect(tx.testRun.create).toHaveBeenCalledTimes(2);
    expect(tx.systemTestAssessment.create.mock.calls[0][0].data).toMatchObject({sourceHash:'source',testHash:'new-tests',status:'COMPLETED',testRunId:'two',reportJson:{runs:[{testRunId:'one'},{testRunId:'two'}]}});
    tx.systemTestAssessment.findUnique.mockResolvedValue({id:'assessment'});
    await publishAppliedAssessment(options);
    expect(tx.testRun.create).toHaveBeenCalledTimes(2);
});
