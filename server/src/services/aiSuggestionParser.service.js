import { ServiceError } from "../utils/serviceError.js";

/**
 * SCRUM-301: Parse AI response
 * Extracts a JSON block from the AI's markdown response and parses it.
 */
export const parseAiResponse = (responseText) => {
    if (!responseText || typeof responseText !== "string") {
        throw new ServiceError("Invalid AI response text", 400);
    }

    // Try to find JSON within markdown code blocks e.g. ```json ... ```
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    let jsonString = jsonMatch ? jsonMatch[1] : responseText;

    // Sometimes the AI might omit the ```json and just use ```
    if (!jsonMatch) {
        const genericMatch = responseText.match(/```\s*([\s\S]*?)\s*```/);
        if (genericMatch) {
            jsonString = genericMatch[1];
        }
    }

    try {
        return JSON.parse(jsonString.trim());
    } catch (error) {
        console.error("[AiSuggestionParser] Failed to parse JSON:", jsonString.substring(0, 200));
        throw new ServiceError("Failed to parse AI response as JSON", 500);
    }
};

/**
 * SCRUM-297: Validate output format
 * Ensures the parsed data is an array and contains required fields.
 */
export const validateOutputFormat = (parsedData) => {
    if (!Array.isArray(parsedData)) {
        throw new ServiceError("Parsed AI data must be an array of suggestions", 400);
    }

    parsedData.forEach((item, index) => {
        if (!item || typeof item !== "object") {
            throw new ServiceError(`Item at index ${index} is not a valid object`, 400);
        }
        
        if (!item.filePath || typeof item.filePath !== "string") {
            throw new ServiceError(`Missing or invalid 'filePath' at index ${index}`, 400);
        }
        
        if (!item.functionName || typeof item.functionName !== "string") {
            throw new ServiceError(`Missing or invalid 'functionName' at index ${index}`, 400);
        }
        
        if (!item.message || typeof item.message !== "string") {
            throw new ServiceError(`Missing or invalid 'message' at index ${index}`, 400);
        }
    });

    return true;
};

/**
 * SCRUM-300: Extract function names
 */
export const extractFunctionNames = (item) => {
    return {
        filePath: item.filePath.trim(),
        functionName: item.functionName.trim()
    };
};

/**
 * SCRUM-299: Extract recommendation messages
 */
export const extractRecommendationMessages = (item) => {
    return item.message.trim();
};

/**
 * SCRUM-298: Extract priority levels
 * Normalizes the priority to the AiSuggestionPriority enum.
 */
export const extractPriorityLevels = (item) => {
    const rawPriority = item.priority ? String(item.priority).toUpperCase().trim() : "LOW";
    
    // Fallback to LOW if it doesn't match HIGH or MEDIUM
    if (rawPriority === "HIGH" || rawPriority === "MEDIUM") {
        return rawPriority;
    }
    
    return "LOW";
};

/**
 * Orchestrator to process raw AI text into valid AiSuggestion objects
 */
export const processAiSuggestions = (responseText, projectId, snapshotId) => {
    const parsedData = parseAiResponse(responseText);
    validateOutputFormat(parsedData);

    const suggestions = parsedData.map(item => {
        const { filePath, functionName } = extractFunctionNames(item);
        const message = extractRecommendationMessages(item);
        const priority = extractPriorityLevels(item);

        return {
            projectId,
            snapshotId,
            filePath,
            functionName,
            priority,
            message
        };
    });

    return suggestions;
};
