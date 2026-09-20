# CHAPTER 1. BACKGROUND

## 1.1 Software Testing

Software testing is the process of evaluating software to determine whether it behaves as expected and satisfies specified requirements. It is an essential activity in software development because it helps identify defects, improve software reliability, and reduce the risks associated with software changes.

Software testing can be performed at different levels, including unit testing, integration testing, system testing, and end-to-end testing. Different testing frameworks can be used depending on the type and purpose of the tests.

CovAI is designed to support automated testing analysis across multiple testing technologies. Its backend contains dedicated job processors for testing and coverage-related activities, including Jest, Supertest, Vitest, and Cypress-related processing. The job queue is used to coordinate these testing operations.

## 1.2 Automated Testing

Automated testing uses software tools and predefined test scripts to execute tests and evaluate software behavior with limited manual intervention. Compared with manual testing, automated testing provides repeatability, reduces repetitive work, and allows test suites to be executed more frequently.

Automated testing is particularly useful for regression testing because the same tests can be executed after software changes to determine whether existing functionality continues to work correctly. However, automated testing also requires appropriate configuration, test maintenance, dependency management, and execution environments.

CovAI incorporates automated test execution into its job-processing pipeline. The system uses a BullMQ-based worker to process different test-related jobs, including regular test execution, Supertest coverage, Vitest execution and coverage, and Cypress system coverage.

## 1.3 Code Coverage

Code coverage is a software testing metric used to measure how much of the source code is executed when a test suite runs. It provides quantitative information about which parts of the code have been exercised by automated tests.

The main types of code coverage include:

- **Line Coverage:** Measures the percentage of executable source-code lines that are executed during testing.
- **Statement Coverage:** Measures the percentage of executable statements that are executed by the test suite.
- **Function Coverage:** Measures the percentage of functions that are executed during testing.
- **Branch Coverage:** Measures the percentage of possible branches of conditional logic that are executed.

CovAI uses coverage information as one source of testing information to help identify potentially insufficiently tested areas. The system implements a robust coverage parsing architecture that processes LCOV and JSON coverage reports to extract summaries, file-level, and function-level metrics.

## 1.4 Static Code Analysis

Static code analysis is the process of examining source code without executing the program. It can be used to understand source-code structure, identify potential problems, and obtain information about software complexity. Unlike dynamic analysis, which analyzes program behavior during execution, static analysis works directly with the source code and its structural representation.

One important technique used in static analysis is Abstract Syntax Tree (AST) analysis. AST analysis allows software tools to identify functions, methods, conditions, and other source-code structures.

CovAI utilizes static analysis to understand source-code structure and complexity. The implementation uses the `@babel/parser` library to generate Abstract Syntax Trees (ASTs) from source code, and employs tree-traversal algorithms to identify and process code components such as functions and methods.

## 1.5 Control Flow Graph

        A Control Flow Graph (CFG) is a graphical representation of the possible execution flow of a program. It represents program statements or blocks as nodes and the possible transitions between them as edges.

        The main elements of a CFG are:
- **Node:** Represents a statement or group of statements.
- **Edge:** Represents a possible control-flow transition.
- **Decision node:** Represents a point where execution can follow different paths.

CFGs are useful for understanding the possible execution paths within a function and provide structural information that can be used to calculate Cyclomatic Complexity. In CovAI, CFG generation is part of the source-code analysis process. The system constructs a graph representation of control-flow structures from parsed source code using a graph-construction algorithm that traverses the AST to identify basic blocks and map transitions.

## 1.6 Cyclomatic Complexity

Cyclomatic Complexity is a software metric used to measure the structural complexity of a program by determining the number of linearly independent paths through its control-flow structure.

For a control flow graph, Cyclomatic Complexity can be calculated using:
$M = E - N + 2P$
where:
- $M$ is the Cyclomatic Complexity.
- $E$ is the number of edges.
- $N$ is the number of nodes.
- $P$ is the number of connected components.

For a simple function, Cyclomatic Complexity can also be understood as:
$M = \text{Number of Decision Points} + 1$

A higher Cyclomatic Complexity generally indicates a function with more independent execution paths and greater structural complexity. CovAI includes Cyclomatic Complexity analysis as part of its static code analysis functionality. The system calculates complexity information for source-code functions and stores the resulting analysis data so that developers can use complexity information together with testing and coverage results.

## 1.7 Large Language Model

A Large Language Model (LLM) is a machine learning model trained on large amounts of data to understand and generate natural language. Modern LLMs can also process and generate programming code, making them applicable to software engineering tasks such as source-code analysis, test-case generation, and development assistance.

CovAI applies LLM-based techniques to support AI-assisted test generation and testing analysis. The system integrates with the Google Generative AI SDK, utilizing the `gemini-3.5-flash-lite` model. It employs a robust retry mechanism with exponential backoff for handling API rate limits and server errors, and uses the `generateContent` method with a high `maxOutputTokens` limit to process prompts and receive comprehensive responses. This AI processing is combined with information obtained from source-code analysis and testing results to provide additional assistance during the software testing process.
