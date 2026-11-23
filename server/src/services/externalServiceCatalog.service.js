const provider = (id, label, category, primaryEnv, hosts, envPatterns, sdkPackages, testKeyHint, {
    testKeyUrl = null, liveKeyPatterns = [], testKeyPatterns = [],
} = {}) => ({
    id, label, category, primaryEnv, hosts, envPatterns, sdkPackages, testKeyUrl, testKeyHint, liveKeyPatterns, testKeyPatterns,
});

export const EXTERNAL_SERVICES = [
    provider('stripe', 'Stripe', 'payments', 'STRIPE_SECRET_KEY', [/^api\.stripe\.com$/i], [/^(?:STRIPE_|(?:VITE_|NEXT_PUBLIC_|REACT_APP_)STRIPE_)/i], ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'],
        'Use a test-mode secret key that starts with sk_test_.', {
            testKeyUrl: 'https://dashboard.stripe.com/test/apikeys',
            liveKeyPatterns: [/^(sk|rk|pk)_live_/],
            testKeyPatterns: [/^(sk|rk|pk)_test_/],
        }),
    provider('paypal', 'PayPal', 'payments', 'PAYPAL_CLIENT_SECRET', [/^api-m\.(?:sandbox\.)?paypal\.com$/i], [/^PAYPAL_/i], ['@paypal/paypal-server-sdk', '@paypal/checkout-server-sdk', '@paypal/paypal-js', 'paypal-rest-sdk'],
        'Use sandbox app credentials with api-m.sandbox.paypal.com instead of api-m.paypal.com.', {testKeyUrl: 'https://developer.paypal.com/dashboard/applications/sandbox'}),
    provider('openai', 'OpenAI', 'ai', 'OPENAI_API_KEY', [/^api\.openai\.com$/i], [/^OPENAI_/i], ['openai'],
        'Use a key from a dedicated test project.', {testKeyUrl: 'https://platform.openai.com/api-keys'}),
    provider('anthropic', 'Anthropic', 'ai', 'ANTHROPIC_API_KEY', [/^api\.anthropic\.com$/i], [/^ANTHROPIC_/i], ['@anthropic-ai/sdk'],
        'Use a key from a dedicated test workspace.'),
    provider('gemini', 'Gemini', 'ai', 'GEMINI_API_KEY', [/^generativelanguage\.googleapis\.com$/i], [/^(?:GEMINI_|GOOGLE_(?:GENERATIVE_AI_|GENAI_)?API_KEY$)/i], ['@google/generative-ai', '@google/genai'],
        'Use an API key from a dedicated test project.', {testKeyUrl: 'https://aistudio.google.com/app/apikey'}),
    provider('sendgrid', 'SendGrid', 'email', 'SENDGRID_API_KEY', [/^api\.sendgrid\.com$/i], [/^SENDGRID_/i], ['@sendgrid/mail', '@sendgrid/client'],
        'Use a restricted test key and SendGrid sandbox mode.'),
    provider('resend', 'Resend', 'email', 'RESEND_API_KEY', [/^api\.resend\.com$/i], [/^RESEND_/i], ['resend'],
        'Use a dedicated key and Resend test addresses.', {testKeyUrl: 'https://resend.com/api-keys'}),
    provider('mailgun', 'Mailgun', 'email', 'MAILGUN_API_KEY', [/^api\.(?:eu\.)?mailgun\.net$/i], [/^MAILGUN_/i], ['mailgun.js', 'mailgun-js'],
        'Use the sandbox domain and an authorized test recipient.'),
    provider('twilio', 'Twilio', 'sms', 'TWILIO_AUTH_TOKEN', [/^(?:[a-z0-9-]+\.)*api\.twilio\.com$/i], [/^TWILIO_/i], ['twilio'],
        'Use the test Account SID and Auth Token from the Twilio Console.'),
    provider('cloudinary', 'Cloudinary', 'storage', 'CLOUDINARY_URL', [/^(?:api|res)\.cloudinary\.com$/i], [/^CLOUDINARY_/i], ['cloudinary'],
        'Use credentials for a separate test product environment.'),
    provider('aws-s3', 'AWS S3', 'storage', 'AWS_ACCESS_KEY_ID', [/(?:^|\.)amazonaws\.com$/i], [/^(?:AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|REGION|DEFAULT_REGION|S3_.*)|S3_.*)$/i], ['@aws-sdk/client-s3', 'aws-sdk'],
        'Use scoped credentials for a dedicated test bucket.'),
    provider('firebase', 'Firebase', 'database', 'FIREBASE_API_KEY', [/(?:^|\.)firebase(?:io|app)\.com$/i, /^(?:firestore|firebase[a-z]*|identitytoolkit|securetoken)\.googleapis\.com$/i, /^googleapis\.com\/firebase(?:\/|$)/i], [/^(?:(?:VITE_|NEXT_PUBLIC_|REACT_APP_)?FIREBASE_)/i], ['firebase', 'firebase-admin'],
        'Use the Firebase Emulator Suite or a separate test project.'),
    provider('supabase', 'Supabase', 'database', 'SUPABASE_ANON_KEY', [/(?:^|\.)supabase\.co$/i], [/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)?SUPABASE_/i], ['@supabase/supabase-js'],
        'Use keys for a local or dedicated test project.'),
    provider('google-oauth', 'Google OAuth', 'auth', 'GOOGLE_CLIENT_SECRET', [/^oauth2\.googleapis\.com$/i], [/^GOOGLE_(?:OAUTH_|CLIENT_(?:ID|SECRET)$)/i], ['passport-google-oauth20', 'google-auth-library'],
        'Use a test OAuth client with the test callback URL.'),
    provider('github-oauth', 'GitHub OAuth', 'auth', 'GITHUB_CLIENT_SECRET', [/^github\.com\/login\/oauth(?:\/|$)/i, /^api\.github\.com$/i], [/^GITHUB_(?:OAUTH_|CLIENT_)/i], ['passport-github', 'passport-github2', '@octokit/oauth-app'],
        'Use a separate OAuth app with the test callback URL.'),
    provider('mapbox', 'Mapbox', 'maps', 'MAPBOX_ACCESS_TOKEN', [/(?:^|\.)mapbox\.com$/i], [/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)?MAPBOX_/i], ['mapbox-gl', '@mapbox/mapbox-sdk', '@mapbox/search-js-web'],
        'Use a separate token restricted to the test application.'),
    provider('google-maps', 'Google Maps', 'maps', 'GOOGLE_MAPS_API_KEY', [/^maps\.googleapis\.com$/i], [/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)?GOOGLE_MAPS_/i], ['@googlemaps/google-maps-services-js', '@googlemaps/js-api-loader'],
        'Use an API key restricted to the test app and required Maps APIs.'),
    provider('algolia', 'Algolia', 'search', 'ALGOLIA_API_KEY', [/(?:^|\.)(?:algolia\.net|algolianet\.com)$/i], [/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)?ALGOLIA_/i], ['algoliasearch', 'instantsearch.js', 'react-instantsearch'],
        'Use a restricted key for a test index.'),
    provider('pusher', 'Pusher', 'realtime', 'PUSHER_KEY', [/(?:^|\.)pusher\.com$/i], [/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)?PUSHER_/i], ['pusher', 'pusher-js'],
        'Use credentials from a separate test app.'),
    provider('sentry', 'Sentry', 'monitoring', 'SENTRY_DSN', [/(?:^|\.)sentry\.io$/i], [/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)?SENTRY_/i], ['@sentry/node', '@sentry/browser', '@sentry/react', '@sentry/nextjs', '@sentry/vue'],
        'Use a DSN from a dedicated test project.'),
];

export const serviceForEnvName = name => EXTERNAL_SERVICES.find(service => service.envPatterns.some(pattern => pattern.test(name))) ?? null;
export const serviceForHost = host => {
    const address = host.replace(/^https?:\/\//i, '').split(/[?#]/, 1)[0];
    const hostname = address.split('/', 1)[0].replace(/:\d+$/, '').replace(/\.$/, '');
    return EXTERNAL_SERVICES.find(service => service.hosts.some(pattern => pattern.test(address) || pattern.test(hostname))) ?? null;
};
export const serviceForPackage = pkg => {
    const packageName = pkg.split('/').slice(0, pkg.startsWith('@') ? 2 : 1).join('/');
    return EXTERNAL_SERVICES.find(service => service.sdkPackages.includes(packageName)) ?? null;
};
export const isLiveCredential = (name, value) => EXTERNAL_SERVICES.some(service =>
    service.envPatterns.some(pattern => pattern.test(name)) && service.liveKeyPatterns.some(pattern => pattern.test(value.trim())));
