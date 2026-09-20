# Detect Testing Framework Main Flow

## 1. Test Generation Flow

| Step | Actor Action | System Response |
| :--- | :--- | :--- |
| 1 | User requests test generation | Verify project ownership and snapshot existence |
| 2 | System builds AI context | Retrieve project source code and metadata |
| 3 | System constructs prompt | Generate prompt based on framework and source code |
| 4 | System calls AI service | Receive generated test code |
| 5 | System validates code | Check syntax and structure of generated test |
| 6 | System saves result | Store test in database |

## 2. Job Queuing Flow (e.g., Cypress)

| Step | Actor Action | System Response |
| :--- | :--- | :--- |
| 1 | User requests job queue | Verify project ownership |
| 2 | System resolves snapshot | Identify latest or provided snapshot |
| 3 | System creates job | Create job record in database (deduplicated) |
| 4 | System enqueues job | Add job to processing queue |