import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveLatestOwnedProjectSnapshot, resolveOwnedProjectSnapshot } from "./projectScope.service.js";
import { analyzeFrameworkRecommendation } from "./frameworkRecommendationAnalyzer.service.js";

const SUPPORTED_FRAMEWORKS = new Set(["jest", "vitest"]);

const resolveSnapshot = ({ projectId, snapshotId, userId }) => (
    snapshotId
        ? resolveOwnedProjectSnapshot({ projectId, snapshotId, userId, requireRoot: true })
        : resolveLatestOwnedProjectSnapshot({ projectId, userId, requireRoot: true })
);

const selectionDetails = (recommendation, framework) => {
    if (!framework) return { requiresInstallation: null };
    const candidate = recommendation.candidates.find((item) => item.framework === framework);
    return { requiresInstallation: Boolean(candidate?.requiresInstallation) };
};

export const getFrameworkRecommendation = async ({ projectId, snapshotId, userId }) => {
    const { snapshot } = await resolveSnapshot({ projectId, snapshotId, userId });
    const recommendation = analyzeFrameworkRecommendation(snapshot.rootDir);
    await prisma.projectSnapshot.update({
        where: { id: snapshot.id },
        data: { frameworkRecommendationJson: JSON.stringify(recommendation) },
    });
    const selectedTestingFramework = SUPPORTED_FRAMEWORKS.has(snapshot.selectedTestingFramework)
        ? snapshot.selectedTestingFramework
        : null;
    return {
        snapshotId: snapshot.id,
        ...recommendation,
        selectedTestingFramework,
        selection: selectionDetails(recommendation, selectedTestingFramework),
    };
};

export const selectTestingFramework = async ({ projectId, snapshotId, userId, framework }) => {
    if (!SUPPORTED_FRAMEWORKS.has(framework)) {
        throw new ServiceError("framework must be jest or vitest", 400);
    }
    if (!snapshotId || typeof snapshotId !== "string") {
        throw new ServiceError("snapshotId is required", 400);
    }
    const { snapshot } = await resolveSnapshot({ projectId, snapshotId, userId });
    const recommendation = analyzeFrameworkRecommendation(snapshot.rootDir);
    await prisma.projectSnapshot.update({
        where: { id: snapshot.id },
        data: {
            frameworkRecommendationJson: JSON.stringify(recommendation),
            selectedTestingFramework: framework,
        },
    });
    return {
        snapshotId: snapshot.id,
        ...recommendation,
        selectedTestingFramework: framework,
        selection: selectionDetails(recommendation, framework),
    };
};
