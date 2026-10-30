import { jest } from '@jest/globals';
import { dispatchInvitationDeliveries } from '../services/invitationDelivery.service.js';
import { encrypt } from '../utils/crypto.js';

describe('invitation email outbox delivery', () => {
    let db,send,row;
    beforeEach(() => {
        row = { id:'delivery',status:'SENDING',attempts:1,invitationRevision:1,
            encryptedPayload:encrypt(JSON.stringify({email:'invitee@example.test',token:'b'.repeat(64)})),
            invitation:{status:'PENDING',revision:1,expiresAt:new Date('2099-01-01T00:00:00Z'),role:'EDITOR',
                project:{name:'Coverage workspace'},invitedBy:{name:'Project Owner'}} };
        db = {invitationDelivery:{findMany:jest.fn(async()=>[{id:'delivery',status:'QUEUED',attempts:0}]),
            updateMany:jest.fn(async()=>({count:1})),findUnique:jest.fn(async()=>row)}};
        send = jest.fn(async()=>({accepted:['invitee@example.test']}));
    });
    test('sends a branded multipart invitation and scrubs its token after SMTP acceptance', async () => {
        await dispatchInvitationDeliveries({db,send});
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(expect.objectContaining({email:'invitee@example.test',
            subject:expect.stringContaining('Coverage workspace'),html:expect.stringContaining('Accept invitation'),
            message:expect.stringContaining(`/invitations/${'b'.repeat(64)}`)}));
        expect(send.mock.calls[0][0].html).toContain('Project Owner');
        expect(db.invitationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:'SENT',encryptedPayload:null,lastErrorCode:null})}));
    });
    test('does not send a revoked or expired invitation', async () => {
        row.invitation.expiresAt=new Date('2000-01-01T00:00:00Z');
        await dispatchInvitationDeliveries({db,send});
        expect(send).not.toHaveBeenCalled();
        expect(db.invitationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:'CANCELED',encryptedPayload:null})}));
    });
    test('retains retry behavior without persisting transport secrets', async () => {
        send.mockRejectedValue(new Error('private-password token-url credential diagnostic'));
        await dispatchInvitationDeliveries({db,send});
        expect(db.invitationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:'FAILED',lastErrorCode:'EMAIL_DELIVERY_FAILED',nextAttemptAt:expect.any(Date)})}));
        expect(JSON.stringify(db.invitationDelivery.updateMany.mock.calls)).not.toContain('private-password');
    });
    test('a second dispatcher cannot send a row already claimed by another worker', async () => {
        db.invitationDelivery.updateMany.mockResolvedValue({count:0});
        await dispatchInvitationDeliveries({db,send});
        expect(send).not.toHaveBeenCalled();
        expect(db.invitationDelivery.findUnique).not.toHaveBeenCalled();
    });
});
