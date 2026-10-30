import { jest } from '@jest/globals';
const sendMail = jest.fn(async options => ({ accepted: [options.to] }));
const verify = jest.fn(async () => true);
const createTransport = jest.fn(() => ({ sendMail, verify }));
await jest.unstable_mockModule('nodemailer', () => ({ default: { createTransport } }));
const keys = ['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USERNAME','SMTP_PASSWORD','EMAIL_USERNAME','EMAIL_APP_PASSWORD','EMAIL_FROM'];
const original = Object.fromEntries(keys.map(key => [key,process.env[key]]));
beforeEach(() => { jest.resetModules();jest.clearAllMocks();for (const key of keys) delete process.env[key]; });
afterAll(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key];else process.env[key]=original[key]; } });
test('invitation and password-reset content use the existing Gmail credentials and configured sender', async () => {
    process.env.EMAIL_USERNAME='sender@example.test';process.env.EMAIL_APP_PASSWORD='test-app-password';
    const {sendEmail,verifyEmailTransport}=await import('../utils/sendEmail.js');
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({service:'Gmail',auth:{user:'sender@example.test',pass:'test-app-password'},socketTimeout:30000}));
    await sendEmail({email:'member@example.test',subject:'Invitation',message:'Text fallback',html:'<p>Invitation</p>'});
    await sendEmail({email:'member@example.test',subject:'Reset password',html:'<p>Reset</p>'});
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenNthCalledWith(1,expect.objectContaining({from:{name:'CovAI',address:'sender@example.test'},text:'Text fallback',html:'<p>Invitation</p>'}));
    await verifyEmailTransport();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
});
test('keeps explicit SMTP and EMAIL_FROM overrides, including unauthenticated Mailpit', async () => {
    process.env.SMTP_HOST='127.0.0.1';process.env.SMTP_PORT='51025';process.env.EMAIL_FROM='CovAI <custom@example.test>';
    const {sendEmail}=await import('../utils/sendEmail.js');
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({host:'127.0.0.1',port:51025,secure:false}));
    expect(createTransport.mock.calls[0][0].auth).toBeUndefined();
    await sendEmail({email:'member@example.test',subject:'Invite'});
    expect(sendMail.mock.calls[0][0].from).toBe('CovAI <custom@example.test>');
});
