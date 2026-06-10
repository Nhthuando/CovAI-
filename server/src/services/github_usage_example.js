import { GitHubRepositoryAccessService } from "./github.service.js";

async function exampleUsage(userId) {
  try {
    const repos =
      await GitHubRepositoryAccessService.getUserRepositories(userId);
    console.log("Repositories:", repos);
  } catch (error) {
    console.error("Error fetching repositories:", error.message);
  }
}
