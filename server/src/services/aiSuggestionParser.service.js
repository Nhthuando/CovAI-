import { ServiceError } from "../utils/serviceError.js";
import { jsonrepair } from "jsonrepair";

/**
 * SCRUM-301: Parse AI response
 * Extracts a JSON block from the AI's markdown response and parses it.
 * Includes repair logic for truncated or malformed responses using jsonrepair.
 */
export const parseAiResponse = (responseText) => {
    if (!responseText || typeof responseText !== "string") {
        throw new ServiceError("Invalid AI response text", 400);
    }

    // Try to find JSON within markdown code blocks e.g. ```json ... ```
    let jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    let jsonString = jsonMatch ? jsonMatch[1] : responseText;

    // Sometimes the AI might omit the ```json and just use ```
    if (!jsonMatch) {
        const genericMatch = responseText.match(/```\s*([\s\S]*?)\s*```/);
        if (genericMatch) {
            jsonString = genericMatch[1];
        }
    }

    // If no code block match, the response may have been truncated before the closing ```.
    // Try to extract JSON starting from ```json to the end.
    if (!jsonMatch) {
        const truncatedMatch = responseText.match(/```json\s*([\s\S]*)/);
        if (truncatedMatch) {
            jsonString = truncatedMatch[1];
            console.warn("[AiSuggestionParser] Detected truncated markdown code block, attempting repair...");
        }
    }

    // Attempt 1: Direct parse
    try {
        return JSON.parse(jsonString.trim());
    } catch (firstError) {
        console.warn("[AiSuggestionParser] Direct JSON.parse failed, attempting repair using jsonrepair...");
    }

    // Attempt 2: Repair JSON using jsonrepair
    try {
        const repaired = jsonrepair(jsonString);
        const parsed = JSON.parse(repaired);
        console.log("[AiSuggestionParser] Successfully repaired and parsed malformed JSON.");
        return parsed;
    } catch (repairError) {
        // Save the failed raw text for debugging if needed
        import("fs").then(fs => {
            const dumpPath = "failed_ai_json_dump.txt";
            fs.writeFileSync(dumpPath, jsonString);
            console.error(`[AiSuggestionParser] Dumped failing JSON to ${dumpPath}`);
        });

        // Log more context for debugging (first 500 chars + last 200 chars)
        const preview = jsonString.length > 700
            ? jsonString.substring(0, 500) + "\n...[TRUNCATED]...\n" + jsonString.substring(jsonString.length - 200)
            : jsonString;
        console.error("[AiSuggestionParser] Failed to parse JSON even after jsonrepair attempt:");
        console.error(preview);
        throw new ServiceError("Failed to parse AI response as JSON", 500);
    }
};

/**
 * SCRUM-297: Validate output format
 * Ensures the parsed data contains the correct object schema.
 */
export const validateOutputFormat = (parsedData) => {
    // If it's an array, it's the old format (backward compatibility)
    if (Array.isArray(parsedData)) {
        return true;
    }

    if (!parsedData || typeof parsedData !== "object") {
        throw new ServiceError("Parsed AI data must be an object with suggestions and tests arrays", 400);
    }

    if (parsedData.suggestions && !Array.isArray(parsedData.suggestions)) {
        throw new ServiceError("parsedData.suggestions must be an array", 400);
    }

    if (parsedData.tests && !Array.isArray(parsedData.tests)) {
        throw new ServiceError("parsedData.tests must be an array", 400);
    }

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
 * Orchestrator to process raw AI text into valid AiSuggestion and AiTest objects
 */
export const processAiSuggestions = (responseText, projectId, snapshotId) => {
    let parsedData = parseAiResponse(responseText);
    validateOutputFormat(parsedData);

    // Normalize backward compatibility
    if (Array.isArray(parsedData)) {
        parsedData = { suggestions: parsedData, tests: [] };
    } else {
        if (!parsedData.suggestions) parsedData.suggestions = [];
        if (!parsedData.tests) parsedData.tests = [];
    }

    const suggestions = parsedData.suggestions.map((item, index) => {
        if (!item.filePath || !item.functionName || !item.message) {
            console.warn(`[processAiSuggestions] Skipping invalid suggestion at index ${index}`);
            return null;
        }

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
    }).filter(Boolean);

    const tests = parsedData.tests.map((item, index) => {
        if (!item.filePath || !item.content) {
            console.warn(`[processAiSuggestions] Skipping invalid test at index ${index}`);
            return null;
        }

        return {
            projectId,
            snapshotId,
            filePath: item.filePath.trim(),
            mode: item.mode === "SKELETON" ? "SKELETON" : "FULL",
            content: item.content
        };
    }).filter(Boolean);

    return { suggestions, tests };
};
