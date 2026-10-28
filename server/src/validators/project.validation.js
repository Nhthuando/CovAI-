import { z } from "zod";

const githubUrl = z.string().url("Invalid repository URL").refine(
    (value) => value.startsWith("https://github.com/"),
    {
        message: "Only GitHub repositories are supported",
    }
);

export const createProjectSchema = z.object({
    ownerId: z.string().optional(),
    name: z.string().trim().min(1, "Project name is required").min(3, "Project name must be at least 3 characters").max(100, "Project name cannot exceed 100 characters"),
    description: z.string().max(1000, "Description cannot exceed 1000 characters").optional(),
    repoUrl: githubUrl.optional(),
    defaultBranch: z.string().max(100, "Branch name too long").optional(),
    rootDir: z.string().optional(),
    jestConfigPath: z.string().optional(),
});

export function parseCreateProject(body) {
    const result = createProjectSchema.safeParse(body);
    if (!result.success) {
        return {
            success: false,
            error: result.error.issues[0],
        };
    }

    return {
        success: true,
        data: result.data,
    };
}
