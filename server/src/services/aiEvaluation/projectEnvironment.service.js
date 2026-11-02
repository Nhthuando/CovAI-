const providerName = /^(?:(?:GEMINI|GOOGLE|OPENAI|ANTHROPIC|GROQ|AZURE_OPENAI|OLLAMA)_(?:API_KEY|API_URL|BASE_URL|ENDPOINT|MODEL|PROJECT_ID|LOCATION)|HF_TOKEN|HUGGINGFACEHUB_API_TOKEN)$/;
const managed = new Set(['PORT', 'HOST', 'NODE_ENV']);

/** Static references are suggestions, never a list of required credentials. */
export function assessProjectEnvironment(allNames = [], relatedNames = []) {
    const all = [...new Set(allNames)].sort();
    const related = new Set(relatedNames);
    return {
        provenance: 'STATIC_SOURCE_REFERENCES',
        providerReferences: all.filter(name => providerName.test(name)),
        runtimeManaged: all.filter(name => managed.has(name)),
        chatbotDependencyReferences: all.filter(name => related.has(name) && !providerName.test(name) && !managed.has(name)),
        otherProjectReferences: all.filter(name => !related.has(name) && !providerName.test(name) && !managed.has(name)),
        requiredNames: [], // Only runtime/configuration validation can establish a requirement.
    };
}
