# Built-in middleware

> Prebuilt middleware for common agent use cases

LangChain provides prebuilt middleware for common use cases. Each middleware is production-ready and configurable for your specific needs.

## Provider-agnostic middleware

The following middleware work with any LLM provider:

| Middleware                              | Description                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| [Summarization](#summarization)         | Automatically summarize conversation history when approaching token limits. |
| [Human-in-the-loop](#human-in-the-loop) | Pause execution for human approval of tool calls.                           |
| [Model call limit](#model-call-limit)   | Limit the number of model calls to prevent excessive costs.                 |
| [Tool call limit](#tool-call-limit)     | Control tool execution by limiting call counts.                             |
| [Model fallback](#model-fallback)       | Automatically fallback to alternative models when primary fails.            |
| [PII detection](#pii-detection)         | Detect and handle Personally Identifiable Information (PII).                |
| [To-do list](#to-do-list)               | Equip agents with task planning and tracking capabilities.                  |
| [LLM tool selector](#llm-tool-selector) | Use an LLM to select relevant tools before calling main model.              |
| [Tool retry](#tool-retry)               | Automatically retry failed tool calls with exponential backoff.             |
| [Model retry](#model-retry)             | Automatically retry failed model calls with exponential backoff.            |
| [LLM tool emulator](#llm-tool-emulator) | Emulate tool execution using an LLM for testing purposes.                   |
| [Context editing](#context-editing)     | Manage conversation context by trimming or clearing tool uses.              |

### Summarization

Automatically summarize conversation history when approaching token limits, preserving recent messages while compressing older context. Summarization is useful for the following:

* Long-running conversations that exceed context windows.
* Multi-turn dialogues with extensive history.
* Applications where preserving full conversation context matters.

```typescript  theme={null}
import { createAgent, summarizationMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [weatherTool, calculatorTool],
  middleware: [
    summarizationMiddleware({
      model: "gpt-4o-mini",
      trigger: { tokens: 4000 },
      keep: { messages: 20 },
    }),
  ],
});
```

<Accordion title="Configuration options">
  <Tip>
    The `fraction` conditions for `trigger` and `keep` (shown below) rely on a chat model's [profile data](/oss/javascript/langchain/models#model-profiles) if using `langchain@1.1.0`. If data are not available, use another condition or specify manually:

    ```typescript  theme={null}
    const customProfile: ModelProfile = {
        maxInputTokens: 100_000,
        // ...
    }
    model = await initChatModel("...", {
        profile: customProfile,
    });
    ```
  </Tip>

  <ParamField body="model" type="string | BaseChatModel" required>
    Model for generating summaries. Can be a model identifier string (e.g., `'openai:gpt-4o-mini'`) or a `BaseChatModel` instance.
  </ParamField>

  <ParamField body="trigger" type="object | object[]">
    Conditions for triggering summarization. Can be:

    * A single condition object (all properties must be met - AND logic)
    * An array of condition objects (any condition must be met - OR logic)

    Each condition can include:

    * `fraction` (number): Fraction of model's context size (0-1)
    * `tokens` (number): Absolute token count
    * `messages` (number): Message count

    At least one property must be specified per condition. If not provided, summarization will not trigger automatically.
  </ParamField>

  <ParamField body="keep" type="object" default="{messages: 20}">
    How much context to preserve after summarization. Specify exactly one of:

    * `fraction` (number): Fraction of model's context size to keep (0-1)
    * `tokens` (number): Absolute token count to keep
    * `messages` (number): Number of recent messages to keep
  </ParamField>

  <ParamField body="tokenCounter" type="function">
    Custom token counting function. Defaults to character-based counting.
  </ParamField>

  <ParamField body="summaryPrompt" type="string">
    Custom prompt template for summarization. Uses built-in template if not specified. The template should include `{messages}` placeholder where conversation history will be inserted.
  </ParamField>

  <ParamField body="trimTokensToSummarize" type="number" default="4000">
    Maximum number of tokens to include when generating the summary. Messages will be trimmed to fit this limit before summarization.
  </ParamField>

  <ParamField body="summaryPrefix" type="string">
    Prefix to add to the summary message. If not provided, a default prefix is used.
  </ParamField>

  <ParamField body="maxTokensBeforeSummary" type="number" deprecated>
    **Deprecated:** Use `trigger: { tokens: value }` instead. Token threshold for triggering summarization.
  </ParamField>

  <ParamField body="messagesToKeep" type="number" deprecated>
    **Deprecated:** Use `keep: { messages: value }` instead. Recent messages to preserve.
  </ParamField>
</Accordion>

<Accordion title="Full example">
  The summarization middleware monitors message token counts and automatically summarizes older messages when thresholds are reached.

  **Trigger conditions** control when summarization runs:

  * Single condition object (specified must be met)
  * Array of conditions (any condition must be met - OR logic)
  * Each condition can use `fraction` (of model's context size), `tokens` (absolute count), or `messages` (message count)

  **Keep condition** control how much context to preserve (specify exactly one):

  * `fraction` - Fraction of model's context size to keep
  * `tokens` - Absolute token count to keep
  * `messages` - Number of recent messages to keep

  ```typescript  theme={null}
  import { createAgent, summarizationMiddleware } from "langchain";

  // Single condition
  const agent = createAgent({
    model: "gpt-4o",
    tools: [weatherTool, calculatorTool],
    middleware: [
      summarizationMiddleware({
        model: "gpt-4o-mini",
        trigger: { tokens: 4000, messages: 10 },
        keep: { messages: 20 },
      }),
    ],
  });

  // Multiple conditions
  const agent2 = createAgent({
    model: "gpt-4o",
    tools: [weatherTool, calculatorTool],
    middleware: [
      summarizationMiddleware({
        model: "gpt-4o-mini",
        trigger: [
          { tokens: 3000, messages: 6 },
        ],
        keep: { messages: 20 },
      }),
    ],
  });

  // Using fractional limits
  const agent3 = createAgent({
    model: "gpt-4o",
    tools: [weatherTool, calculatorTool],
    middleware: [
      summarizationMiddleware({
        model: "gpt-4o-mini",
        trigger: { fraction: 0.8 },
        keep: { fraction: 0.3 },
      }),
    ],
  });
  ```
</Accordion>

### Human-in-the-loop

Pause agent execution for human approval, editing, or rejection of tool calls before they execute. [Human-in-the-loop](/oss/javascript/langchain/human-in-the-loop) is useful for the following:

* High-stakes operations requiring human approval (e.g. database writes, financial transactions).
* Compliance workflows where human oversight is mandatory.
* Long-running conversations where human feedback guides the agent.

<Warning>
  Human-in-the-loop middleware requires a [checkpointer](/oss/javascript/langgraph/persistence#checkpoints) to maintain state across interruptions.
</Warning>

```typescript  theme={null}
import { createAgent, humanInTheLoopMiddleware } from "langchain";

function readEmailTool(emailId: string): string {
  /** Mock function to read an email by its ID. */
  return `Email content for ID: ${emailId}`;
}

function sendEmailTool(recipient: string, subject: string, body: string): string {
  /** Mock function to send an email. */
  return `Email sent to ${recipient} with subject '${subject}'`;
}

const agent = createAgent({
  model: "gpt-4o",
  tools: [readEmailTool, sendEmailTool],
  middleware: [
    humanInTheLoopMiddleware({
      interruptOn: {
        sendEmailTool: {
          allowedDecisions: ["approve", "edit", "reject"],
        },
        readEmailTool: false,
      }
    })
  ]
});
```

<Tip>
  For complete examples, configuration options, and integration patterns, see the [Human-in-the-loop documentation](/oss/javascript/langchain/human-in-the-loop).
</Tip>

<Callout icon="circle-play" iconType="solid">
  Watch this [video guide](https://www.youtube.com/watch?v=tdOeUVERukA) demonstrating Human-in-the-loop middleware behavior.
</Callout>

### Model call limit

Limit the number of model calls to prevent infinite loops or excessive costs. Model call limit is useful for the following:

* Preventing runaway agents from making too many API calls.
* Enforcing cost controls on production deployments.
* Testing agent behavior within specific call budgets.

```typescript  theme={null}
import { createAgent, modelCallLimitMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";

const agent = createAgent({
  model: "gpt-4o",
  checkpointer: new MemorySaver(), // Required for thread limiting
  tools: [],
  middleware: [
    modelCallLimitMiddleware({
      threadLimit: 10,
      runLimit: 5,
      exitBehavior: "end",
    }),
  ],
});
```

<Callout icon="circle-play" iconType="solid">
  Watch this [video guide](https://www.youtube.com/watch?v=x5jLQTFXR0Y) demonstrating Model Call Limit middleware behavior.
</Callout>

<Accordion title="Configuration options">
  <ParamField body="threadLimit" type="number">
    Maximum model calls across all runs in a thread. Defaults to no limit.
  </ParamField>

  <ParamField body="runLimit" type="number">
    Maximum model calls per single invocation. Defaults to no limit.
  </ParamField>

  <ParamField body="exitBehavior" type="string" default="end">
    Behavior when limit is reached. Options: `'end'` (graceful termination) or `'error'` (throw exception)
  </ParamField>
</Accordion>

### Tool call limit

Control agent execution by limiting the number of tool calls, either globally across all tools or for specific tools. Tool call limits are useful for the following:

* Preventing excessive calls to expensive external APIs.
* Limiting web searches or database queries.
* Enforcing rate limits on specific tool usage.
* Protecting against runaway agent loops.

```typescript  theme={null}
import { createAgent, toolCallLimitMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [searchTool, databaseTool],
  middleware: [
    toolCallLimitMiddleware({ threadLimit: 20, runLimit: 10 }),
    toolCallLimitMiddleware({
      toolName: "search",
      threadLimit: 5,
      runLimit: 3,
    }),
  ],
});
```

<Callout icon="circle-play" iconType="solid">
  Watch this [video guide](https://www.youtube.com/watch?v=oL6am5UqODY) demonstrating Tool Call Limit middleware behavior.
</Callout>

<Accordion title="Configuration options">
  <ParamField body="toolName" type="string">
    Name of specific tool to limit. If not provided, limits apply to **all tools globally**.
  </ParamField>

  <ParamField body="threadLimit" type="number">
    Maximum tool calls across all runs in a thread (conversation). Persists across multiple invocations with the same thread ID. Requires a checkpointer to maintain state. `undefined` means no thread limit.
  </ParamField>

  <ParamField body="runLimit" type="number">
    Maximum tool calls per single invocation (one user message → response cycle). Resets with each new user message. `undefined` means no run limit.

    **Note:** At least one of `threadLimit` or `runLimit` must be specified.
  </ParamField>

  <ParamField body="exitBehavior" type="string" default="continue">
    Behavior when limit is reached:

    * `'continue'` (default) - Block exceeded tool calls with error messages, let other tools and the model continue. The model decides when to end based on the error messages.
    * `'error'` - Throw a `ToolCallLimitExceededError` exception, stopping execution immediately
    * `'end'` - Stop execution immediately with a ToolMessage and AI message for the exceeded tool call. Only works when limiting a single tool; throws error if other tools have pending calls.
  </ParamField>
</Accordion>

<Accordion title="Full example">
  Specify limits with:

  * **Thread limit** - Max calls across all runs in a conversation (requires checkpointer)
  * **Run limit** - Max calls per single invocation (resets each turn)

  Exit behaviors:

  * `'continue'` (default) - Block exceeded calls with error messages, agent continues
  * `'error'` - Raise exception immediately
  * `'end'` - Stop with ToolMessage + AI message (single-tool scenarios only)

  ```typescript  theme={null}
  import { createAgent, toolCallLimitMiddleware } from "langchain";

  const globalLimiter = toolCallLimitMiddleware({ threadLimit: 20, runLimit: 10 });
  const searchLimiter = toolCallLimitMiddleware({ toolName: "search", threadLimit: 5, runLimit: 3 });
  const databaseLimiter = toolCallLimitMiddleware({ toolName: "query_database", threadLimit: 10 });
  const strictLimiter = toolCallLimitMiddleware({ toolName: "scrape_webpage", runLimit: 2, exitBehavior: "error" });

  const agent = createAgent({
    model: "gpt-4o",
    tools: [searchTool, databaseTool, scraperTool],
    middleware: [globalLimiter, searchLimiter, databaseLimiter, strictLimiter],
  });
  ```
</Accordion>

### Model fallback

Automatically fallback to alternative models when the primary model fails. Model fallback is useful for the following:

* Building resilient agents that handle model outages.
* Cost optimization by falling back to cheaper models.
* Provider redundancy across OpenAI, Anthropic, etc.

```typescript  theme={null}
import { createAgent, modelFallbackMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [],
  middleware: [
    modelFallbackMiddleware(
      "gpt-4o-mini",
      "claude-3-5-sonnet-20241022"
    ),
  ],
});
```

<Accordion title="Configuration options">
  The middleware accepts a variable number of string arguments representing fallback models in order:

  <ParamField body="...models" type="string[]" required>
    One or more fallback model strings to try in order when the primary model fails

    ```typescript  theme={null}
    modelFallbackMiddleware(
      "first-fallback-model",
      "second-fallback-model",
      // ... more models
    )
    ```
  </ParamField>
</Accordion>

### PII detection

Detect and handle Personally Identifiable Information (PII) in conversations using configurable strategies. PII detection is useful for the following:

* Healthcare and financial applications with compliance requirements.
* Customer service agents that need to sanitize logs.
* Any application handling sensitive user data.

```typescript  theme={null}
import { createAgent, piiMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [],
  middleware: [
    piiMiddleware("email", { strategy: "redact", applyToInput: true }),
    piiMiddleware("credit_card", { strategy: "mask", applyToInput: true }),
  ],
});
```

#### Custom PII types

You can create custom PII types by providing a `detector` parameter. This allows you to detect patterns specific to your use case beyond the built-in types.

**Three ways to create custom detectors:**

1. **Regex pattern string** - Simple pattern matching

2. **RegExp object** - More control over regex flags

3. **Custom function** - Complex detection logic with validation

```typescript  theme={null}
import { createAgent, piiMiddleware, type PIIMatch } from "langchain";

// Method 1: Regex pattern string
const agent1 = createAgent({
  model: "gpt-4o",
  tools: [],
  middleware: [
    piiMiddleware("api_key", {
      detector: "sk-[a-zA-Z0-9]{32}",
      strategy: "block",
    }),
  ],
});

// Method 2: RegExp object
const agent2 = createAgent({
  model: "gpt-4o",
  tools: [],
  middleware: [
    piiMiddleware("phone_number", {
      detector: /\+?\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{4}/,
      strategy: "mask",
    }),
  ],
});

// Method 3: Custom detector function
function detectSSN(content: string): PIIMatch[] {
  const matches: PIIMatch[] = [];
  const pattern = /\d{3}-\d{2}-\d{4}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const ssn = match[0];
    // Validate: first 3 digits shouldn't be 000, 666, or 900-999
    const firstThree = parseInt(ssn.substring(0, 3), 10);
    if (firstThree !== 0 && firstThree !== 666 && !(firstThree >= 900 && firstThree <= 999)) {
      matches.push({
        text: ssn,
        start: match.index ?? 0,
        end: (match.index ?? 0) + ssn.length,
      });
    }
  }
  return matches;
}

const agent3 = createAgent({
  model: "gpt-4o",
  tools: [],
  middleware: [
    piiMiddleware("ssn", {
      detector: detectSSN,
      strategy: "hash",
    }),
  ],
});
```

**Custom detector function signature:**

The detector function must accept a string (content) and return matches:

Returns an array of `PIIMatch` objects:

```typescript  theme={null}
interface PIIMatch {
  text: string;    // The matched text
  start: number;   // Start index in content
  end: number;      // End index in content
}

function detector(content: string): PIIMatch[] {
  return [
    { text: "matched_text", start: 0, end: 12 },
    // ... more matches
  ];
}
```

<Tip>
  For custom detectors:

  * Use regex strings for simple patterns
  * Use RegExp objects when you need flags (e.g., case-insensitive matching)
  * Use custom functions when you need validation logic beyond pattern matching
  * Custom functions give you full control over detection logic and can implement complex validation rules
</Tip>

<Accordion title="Configuration options">
  <ParamField body="piiType" type="string" required>
    Type of PII to detect. Can be a built-in type (`email`, `credit_card`, `ip`, `mac_address`, `url`) or a custom type name.
  </ParamField>

  <ParamField body="strategy" type="string" default="redact">
    How to handle detected PII. Options:

    * `'block'` - Throw error when detected
    * `'redact'` - Replace with `[REDACTED_TYPE]`
    * `'mask'` - Partially mask (e.g., `****-****-****-1234`)
    * `'hash'` - Replace with deterministic hash (e.g., `<email_hash:a1b2c3d4>`)
  </ParamField>

  <ParamField body="detector" type="RegExp | string | function">
    Custom detector. Can be:

    * `RegExp` - Regex pattern for matching
    * `string` - Regex pattern string (e.g., `"sk-[a-zA-Z0-9]{32}"`)
    * `function` - Custom detector function `(content: string) => PIIMatch[]`

    If not provided, uses built-in detector for the PII type.
  </ParamField>

  <ParamField body="applyToInput" type="boolean" default="true">
    Check user messages before model call
  </ParamField>

  <ParamField body="applyToOutput" type="boolean" default="false">
    Check AI messages after model call
  </ParamField>

  <ParamField body="applyToToolResults" type="boolean" default="false">
    Check tool result messages after execution
  </ParamField>
</Accordion>

### To-do list

Equip agents with task planning and tracking capabilities for complex multi-step tasks. To-do lists are useful for the following:

* Complex multi-step tasks requiring coordination across multiple tools.
* Long-running operations where progress visibility is important.

<Note>
  This middleware automatically provides agents with a `write_todos` tool and system prompts to guide effective task planning.
</Note>

```typescript  theme={null}
import { createAgent, todoListMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [readFile, writeFile, runTests],
  middleware: [todoListMiddleware()],
});
```

<Callout icon="circle-play" iconType="solid">
  Watch this [video guide](https://www.youtube.com/watch?v=dwvhZ1z_Pas) demonstrating To-do List middleware behavior.
</Callout>

<Accordion title="Configuration options">
  No configuration options available (uses defaults).
</Accordion>

### LLM tool selector

Use an LLM to intelligently select relevant tools before calling the main model. LLM tool selectors are useful for the following:

* Agents with many tools (10+) where most aren't relevant per query.
* Reducing token usage by filtering irrelevant tools.
* Improving model focus and accuracy.

This middleware uses structured output to ask an LLM which tools are most relevant for the current query. The structured output schema defines the available tool names and descriptions. Model providers often add this structured output information to the system prompt behind the scenes.

```typescript  theme={null}
import { createAgent, llmToolSelectorMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [tool1, tool2, tool3, tool4, tool5, ...],
  middleware: [
    llmToolSelectorMiddleware({
      model: "gpt-4o-mini",
      maxTools: 3,
      alwaysInclude: ["search"],
    }),
  ],
});
```

<Accordion title="Configuration options">
  <ParamField body="model" type="string | BaseChatModel">
    Model for tool selection. Can be a model identifier string (e.g., `'openai:gpt-4o-mini'`) or a `BaseChatModel` instance. Defaults to the agent's main model.
  </ParamField>

  <ParamField body="systemPrompt" type="string">
    Instructions for the selection model. Uses built-in prompt if not specified.
  </ParamField>

  <ParamField body="maxTools" type="number">
    Maximum number of tools to select. If the model selects more, only the first maxTools will be used. No limit if not specified.
  </ParamField>

  <ParamField body="alwaysInclude" type="string[]">
    Tool names to always include regardless of selection. These do not count against the maxTools limit.
  </ParamField>
</Accordion>

### Tool retry

Automatically retry failed tool calls with configurable exponential backoff. Tool retry is useful for the following:

* Handling transient failures in external API calls.
* Improving reliability of network-dependent tools.
* Building resilient agents that gracefully handle temporary errors.

**API reference:** [`toolRetryMiddleware`](https://reference.langchain.com/javascript/functions/langchain.index.toolRetryMiddleware.html)

```typescript  theme={null}
import { createAgent, toolRetryMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [searchTool, databaseTool],
  middleware: [
    toolRetryMiddleware({
      maxRetries: 3,
      backoffFactor: 2.0,
      initialDelayMs: 1000,
    }),
  ],
});
```

<Accordion title="Configuration options">
  <ParamField body="maxRetries" type="number" default="2">
    Maximum number of retry attempts after the initial call (3 total attempts with default). Must be >= 0.
  </ParamField>

  <ParamField body="tools" type="(ClientTool | ServerTool | string)[]">
    Optional array of tools or tool names to apply retry logic to. Can be a list of `BaseTool` instances or tool name strings. If `undefined`, applies to all tools.
  </ParamField>

  <ParamField body="retryOn" type="((error: Error) => boolean) | (new (...args: any[]) => Error)[]" default="() => true">
    Either an array of error constructors to retry on, or a function that takes an error and returns `true` if it should be retried. Default is to retry on all errors.
  </ParamField>

  <ParamField body="onFailure" type="'error' | 'continue' | ((error: Error) => string)" default="continue">
    Behavior when all retries are exhausted. Options:

    * `'continue'` (default) - Return a `ToolMessage` with error details, allowing the LLM to handle the failure and potentially recover
    * `'error'` - Re-raise the exception, stopping agent execution
    * Custom function - Function that takes the exception and returns a string for the `ToolMessage` content, allowing custom error formatting

    **Deprecated values:** `'raise'` (use `'error'` instead) and `'return_message'` (use `'continue'` instead). These deprecated values still work but will show a warning.
  </ParamField>

  <ParamField body="backoffFactor" type="number" default="2.0">
    Multiplier for exponential backoff. Each retry waits `initialDelayMs * (backoffFactor ** retryNumber)` milliseconds. Set to `0.0` for constant delay. Must be >= 0.
  </ParamField>

  <ParamField body="initialDelayMs" type="number" default="1000">
    Initial delay in milliseconds before first retry. Must be >= 0.
  </ParamField>

  <ParamField body="maxDelayMs" type="number" default="60000">
    Maximum delay in milliseconds between retries (caps exponential backoff growth). Must be >= 0.
  </ParamField>

  <ParamField body="jitter" type="boolean" default="true">
    Whether to add random jitter (`±25%`) to delay to avoid thundering herd
  </ParamField>
</Accordion>

<Accordion title="Full example">
  The middleware automatically retries failed tool calls with exponential backoff.

  **Key configuration:**

  * `maxRetries` - Number of retry attempts (default: 2)
  * `backoffFactor` - Multiplier for exponential backoff (default: 2.0)
  * `initialDelayMs` - Starting delay in milliseconds (default: 1000ms)
  * `maxDelayMs` - Cap on delay growth (default: 60000ms)
  * `jitter` - Add random variation (default: true)

  **Failure handling:**

  * `onFailure: "continue"` (default) - Return error message
  * `onFailure: "error"` - Re-raise exception
  * Custom function - Function returning error message

  ```typescript  theme={null}
  import { createAgent, toolRetryMiddleware } from "langchain";
  import { tool } from "@langchain/core/tools";
  import { z } from "zod";

  // Basic usage with default settings (2 retries, exponential backoff)
  const agent = createAgent({
    model: "gpt-4o",
    tools: [searchTool, databaseTool],
    middleware: [toolRetryMiddleware()],
  });

  // Retry specific exceptions only
  const retry = toolRetryMiddleware({
    maxRetries: 4,
    retryOn: [TimeoutError, NetworkError],
    backoffFactor: 1.5,
  });

  // Custom exception filtering
  function shouldRetry(error: Error): boolean {
    // Only retry on 5xx errors
    if (error.name === "HTTPError" && "statusCode" in error) {
      const statusCode = (error as any).statusCode;
      return 500 <= statusCode && statusCode < 600;
    }
    return false;
  }

  const retryWithFilter = toolRetryMiddleware({
    maxRetries: 3,
    retryOn: shouldRetry,
  });

  // Apply to specific tools with custom error handling
  const formatError = (error: Error) =>
    "Database temporarily unavailable. Please try again later.";

  const retrySpecificTools = toolRetryMiddleware({
    maxRetries: 4,
    tools: ["search_database"],
    onFailure: formatError,
  });

  // Apply to specific tools using BaseTool instances
  const searchDatabase = tool(
    async ({ query }) => {
      // Search implementation
      return results;
    },
    {
      name: "search_database",
      description: "Search the database",
      schema: z.object({ query: z.string() }),
    }
  );

  const retryWithToolInstance = toolRetryMiddleware({
    maxRetries: 4,
    tools: [searchDatabase], // Pass BaseTool instance
  });

  // Constant backoff (no exponential growth)
  const constantBackoff = toolRetryMiddleware({
    maxRetries: 5,
    backoffFactor: 0.0, // No exponential growth
    initialDelayMs: 2000, // Always wait 2 seconds
  });

  // Raise exception on failure
  const strictRetry = toolRetryMiddleware({
    maxRetries: 2,
    onFailure: "error", // Re-raise exception instead of returning message
  });
  ```
</Accordion>

### Model retry

Automatically retry failed model calls with configurable exponential backoff. Model retry is useful for the following:

* Handling transient failures in model API calls.
* Improving reliability of network-dependent model requests.
* Building resilient agents that gracefully handle temporary model errors.

**API reference:** [`modelRetryMiddleware`](https://reference.langchain.com/javascript/functions/langchain.index.modelRetryMiddleware.html)

```typescript  theme={null}
import { createAgent, modelRetryMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [searchTool, databaseTool],
  middleware: [
    modelRetryMiddleware({
      maxRetries: 3,
      backoffFactor: 2.0,
      initialDelayMs: 1000,
    }),
  ],
});
```

<Accordion title="Configuration options">
  <ParamField body="maxRetries" type="number" default="2">
    Maximum number of retry attempts after the initial call (3 total attempts with default). Must be >= 0.
  </ParamField>

  <ParamField body="retryOn" type="((error: Error) => boolean) | (new (...args: any[]) => Error)[]" default="() => true">
    Either an array of error constructors to retry on, or a function that takes an error and returns `true` if it should be retried. Default is to retry on all errors.
  </ParamField>

  <ParamField body="onFailure" type="'error' | 'continue' | ((error: Error) => string)" default="continue">
    Behavior when all retries are exhausted. Options:

    * `'continue'` (default) - Return an `AIMessage` with error details, allowing the agent to potentially handle the failure gracefully
    * `'error'` - Re-raise the exception, stopping agent execution
    * Custom function - Function that takes the exception and returns a string for the `AIMessage` content, allowing custom error formatting
  </ParamField>

  <ParamField body="backoffFactor" type="number" default="2.0">
    Multiplier for exponential backoff. Each retry waits `initialDelayMs * (backoffFactor ** retryNumber)` milliseconds. Set to `0.0` for constant delay. Must be >= 0.
  </ParamField>

  <ParamField body="initialDelayMs" type="number" default="1000">
    Initial delay in milliseconds before first retry. Must be >= 0.
  </ParamField>

  <ParamField body="maxDelayMs" type="number" default="60000">
    Maximum delay in milliseconds between retries (caps exponential backoff growth). Must be >= 0.
  </ParamField>

  <ParamField body="jitter" type="boolean" default="true">
    Whether to add random jitter (`±25%`) to delay to avoid thundering herd
  </ParamField>
</Accordion>

<Accordion title="Full example">
  The middleware automatically retries failed model calls with exponential backoff.

  ```typescript  theme={null}
  import { createAgent, modelRetryMiddleware } from "langchain";

  // Basic usage with default settings (2 retries, exponential backoff)
  const agent = createAgent({
    model: "gpt-4o",
    tools: [searchTool],
    middleware: [modelRetryMiddleware()],
  });

  class TimeoutError extends Error {
      // ...
  }
  class NetworkError extends Error {
      // ...
  }

  // Retry specific exceptions only
  const retry = modelRetryMiddleware({
    maxRetries: 4,
    retryOn: [TimeoutError, NetworkError],
    backoffFactor: 1.5,
  });

  // Custom exception filtering
  function shouldRetry(error: Error): boolean {
    // Only retry on rate limit errors
    if (error.name === "RateLimitError") {
      return true;
    }
    // Or check for specific HTTP status codes
    if (error.name === "HTTPError" && "statusCode" in error) {
      const statusCode = (error as any).statusCode;
      return statusCode === 429 || statusCode === 503;
    }
    return false;
  }

  const retryWithFilter = modelRetryMiddleware({
    maxRetries: 3,
    retryOn: shouldRetry,
  });

  // Return error message instead of raising
  const retryContinue = modelRetryMiddleware({
    maxRetries: 4,
    onFailure: "continue", // Return AIMessage with error instead of throwing
  });

  // Custom error message formatting
  const formatError = (error: Error) =>
    `Model call failed: ${error.message}. Please try again later.`;

  const retryWithFormatter = modelRetryMiddleware({
    maxRetries: 4,
    onFailure: formatError,
  });

  // Constant backoff (no exponential growth)
  const constantBackoff = modelRetryMiddleware({
    maxRetries: 5,
    backoffFactor: 0.0, // No exponential growth
    initialDelayMs: 2000, // Always wait 2 seconds
  });

  // Raise exception on failure
  const strictRetry = modelRetryMiddleware({
    maxRetries: 2,
    onFailure: "error", // Re-raise exception instead of returning message
  });
  ```
</Accordion>

### LLM tool emulator

Emulate tool execution using an LLM for testing purposes, replacing actual tool calls with AI-generated responses. LLM tool emulators are useful for the following:

* Testing agent behavior without executing real tools.
* Developing agents when external tools are unavailable or expensive.
* Prototyping agent workflows before implementing actual tools.

```typescript  theme={null}
import { createAgent, toolEmulatorMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [getWeather, searchDatabase, sendEmail],
  middleware: [
    toolEmulatorMiddleware(), // Emulate all tools
  ],
});
```

<Accordion title="Configuration options">
  <ParamField body="tools" type="(string | ClientTool | ServerTool)[]">
    List of tool names (string) or tool instances to emulate. If `undefined` (default), ALL tools will be emulated. If empty array `[]`, no tools will be emulated. If array with tool names/instances, only those tools will be emulated.
  </ParamField>

  <ParamField body="model" type="string | BaseChatModel">
    Model to use for generating emulated tool responses. Can be a model identifier string (e.g., `'anthropic:claude-sonnet-4-5-20250929'`) or a `BaseChatModel` instance. Defaults to the agent's model if not specified.
  </ParamField>
</Accordion>

<Accordion title="Full example">
  The middleware uses an LLM to generate plausible responses for tool calls instead of executing the actual tools.

  ```typescript  theme={null}
  import { createAgent, toolEmulatorMiddleware, tool } from "langchain";
  import * as z from "zod";

  const getWeather = tool(
    async ({ location }) => `Weather in ${location}`,
    {
      name: "get_weather",
      description: "Get the current weather for a location",
      schema: z.object({ location: z.string() }),
    }
  );

  const sendEmail = tool(
    async ({ to, subject, body }) => "Email sent",
    {
      name: "send_email",
      description: "Send an email",
      schema: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string(),
      }),
    }
  );

  // Emulate all tools (default behavior)
  const agent = createAgent({
    model: "gpt-4o",
    tools: [getWeather, sendEmail],
    middleware: [toolEmulatorMiddleware()],
  });

  // Emulate specific tools by name
  const agent2 = createAgent({
    model: "gpt-4o",
    tools: [getWeather, sendEmail],
    middleware: [
      toolEmulatorMiddleware({
        tools: ["get_weather"],
      }),
    ],
  });

  // Emulate specific tools by passing tool instances
  const agent3 = createAgent({
    model: "gpt-4o",
    tools: [getWeather, sendEmail],
    middleware: [
      toolEmulatorMiddleware({
        tools: [getWeather],
      }),
    ],
  });

  // Use custom model for emulation
  const agent5 = createAgent({
    model: "gpt-4o",
    tools: [getWeather, sendEmail],
    middleware: [
      toolEmulatorMiddleware({
        model: "claude-sonnet-4-5-20250929",
      }),
    ],
  });
  ```
</Accordion>

### Context editing

Manage conversation context by clearing older tool call outputs when token limits are reached, while preserving recent results. This helps keep context windows manageable in long conversations with many tool calls. Context editing is useful for the following:

* Long conversations with many tool calls that exceed token limits
* Reducing token costs by removing older tool outputs that are no longer relevant
* Maintaining only the most recent N tool results in context

```typescript  theme={null}
import { createAgent, contextEditingMiddleware, ClearToolUsesEdit } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [],
  middleware: [
    contextEditingMiddleware({
      edits: [
        new ClearToolUsesEdit({
          triggerTokens: 100000,
          keep: 3,
        }),
      ],
    }),
  ],
});
```

<Accordion title="Configuration options">
  <ParamField body="edits" type="ContextEdit[]" default="[new ClearToolUsesEdit()]">
    Array of [`ContextEdit`](https://reference.langchain.com/javascript/interfaces/langchain.index.ContextEdit.html) strategies to apply
  </ParamField>

  **[`ClearToolUsesEdit`](https://reference.langchain.com/javascript/classes/langchain.index.ClearToolUsesEdit.html) options:**

  <ParamField body="triggerTokens" type="number" default="100000">
    Token count that triggers the edit. When the conversation exceeds this token count, older tool outputs will be cleared.
  </ParamField>

  <ParamField body="clearAtLeast" type="number" default="0">
    Minimum number of tokens to reclaim when the edit runs. If set to 0, clears as much as needed.
  </ParamField>

  <ParamField body="keep" type="number" default="3">
    Number of most recent tool results that must be preserved. These will never be cleared.
  </ParamField>

  <ParamField body="clearToolInputs" type="boolean" default="false">
    Whether to clear the originating tool call parameters on the AI message. When `true`, tool call arguments are replaced with empty objects.
  </ParamField>

  <ParamField body="excludeTools" type="string[]" default="[]">
    List of tool names to exclude from clearing. These tools will never have their outputs cleared.
  </ParamField>

  <ParamField body="placeholder" type="string" default="[cleared]">
    Placeholder text inserted for cleared tool outputs. This replaces the original tool message content.
  </ParamField>
</Accordion>

<Accordion title="Full example">
  The middleware applies context editing strategies when token limits are reached. The most common strategy is `ClearToolUsesEdit`, which clears older tool results while preserving recent ones.

  **How it works:**

  1. Monitor token count in conversation
  2. When threshold is reached, clear older tool outputs
  3. Keep most recent N tool results
  4. Optionally preserve tool call arguments for context

  ```typescript  theme={null}
  import { createAgent, contextEditingMiddleware, ClearToolUsesEdit } from "langchain";

  const agent = createAgent({
    model: "gpt-4o",
    tools: [searchTool, calculatorTool, databaseTool],
    middleware: [
      contextEditingMiddleware({
        edits: [
          new ClearToolUsesEdit({
            triggerTokens: 2000,
            keep: 3,
            clearToolInputs: false,
            excludeTools: [],
            placeholder: "[cleared]",
          }),
        ],
      }),
    ],
  });
  ```
</Accordion>

## Provider-specific middleware

These middleware are optimized for specific LLM providers. See each provider's documentation for full details and examples.

<Columns cols={2}>
  <Card title="Anthropic" href="/oss/javascript/integrations/middleware/anthropic" icon="anthropic" arrow>
    Prompt caching, bash tool, text editor, memory, and file search middleware for Claude models.
  </Card>
</Columns>

***

<Callout icon="pen-to-square" iconType="regular">
  [Edit this page on GitHub](https://github.com/langchain-ai/docs/edit/main/src/oss/langchain/middleware/built-in.mdx) or [file an issue](https://github.com/langchain-ai/docs/issues/new/choose).
</Callout>

<Tip icon="terminal" iconType="regular">
  [Connect these docs](/use-these-docs) to Claude, VSCode, and more via MCP for real-time answers.
</Tip>


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.langchain.com/llms.txt


# Custom middleware

Build custom middleware by implementing hooks that run at specific points in the agent execution flow.

## Hooks

Middleware provides two styles of hooks to intercept agent execution:

<CardGroup cols={2}>
  <Card title="Node-style hooks" icon="share-nodes" href="#node-style-hooks">
    Run sequentially at specific execution points.
  </Card>

  <Card title="Wrap-style hooks" icon="container-storage" href="#wrap-style-hooks">
    Run around each model or tool call.
  </Card>
</CardGroup>

### Node-style hooks

Run sequentially at specific execution points. Use for logging, validation, and state updates.

**Available hooks:**

* `beforeAgent` - Before agent starts (once per invocation)
* `beforeModel` - Before each model call
* `afterModel` - After each model response
* `afterAgent` - After agent completes (once per invocation)

**Example:**

```typescript  theme={null}
import { createMiddleware, AIMessage } from "langchain";

const createMessageLimitMiddleware = (maxMessages: number = 50) => {
  return createMiddleware({
    name: "MessageLimitMiddleware",
    beforeModel: (state) => {
      if (state.messages.length === maxMessages) {
        return {
          messages: [new AIMessage("Conversation limit reached.")],
          jumpTo: "end",
        };
      }
      return;
    },
    afterModel: (state) => {
      const lastMessage = state.messages[state.messages.length - 1];
      console.log(`Model returned: ${lastMessage.content}`);
      return;
    },
  });
};
```

### Wrap-style hooks

Intercept execution and control when the handler is called. Use for retries, caching, and transformation.

You decide if the handler is called zero times (short-circuit), once (normal flow), or multiple times (retry logic).

**Available hooks:**

* `wrapModelCall` - Around each model call
* `wrapToolCall` - Around each tool call

**Example:**

```typescript  theme={null}
import { createMiddleware } from "langchain";

const createRetryMiddleware = (maxRetries: number = 3) => {
  return createMiddleware({
    name: "RetryMiddleware",
    wrapModelCall: (request, handler) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return handler(request);
        } catch (e) {
          if (attempt === maxRetries - 1) {
            throw e;
          }
          console.log(`Retry ${attempt + 1}/${maxRetries} after error: ${e}`);
        }
      }
      throw new Error("Unreachable");
    },
  });
};
```

## Create middleware

Use the `createMiddleware` function to define custom middleware:

```typescript  theme={null}
import { createMiddleware } from "langchain";

const loggingMiddleware = createMiddleware({
  name: "LoggingMiddleware",
  beforeModel: (state) => {
    console.log(`About to call model with ${state.messages.length} messages`);
    return;
  },
  afterModel: (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    console.log(`Model returned: ${lastMessage.content}`);
    return;
  },
});
```

## Custom state schema

Middleware can extend the agent's state with custom properties. This enables middleware to:

* **Track state across execution**: Maintain counters, flags, or other values that persist throughout the agent's execution lifecycle

* **Share data between hooks**: Pass information from `beforeModel` to `afterModel` or between different middleware instances

* **Implement cross-cutting concerns**: Add functionality like rate limiting, usage tracking, user context, or audit logging without modifying the core agent logic

* **Make conditional decisions**: Use accumulated state to determine whether to continue execution, jump to different nodes, or modify behavior dynamically

```typescript  theme={null}
import { createMiddleware, createAgent, HumanMessage } from "langchain";
import * as z from "zod";

const callCounterMiddleware = createMiddleware({
  name: "CallCounterMiddleware",
  stateSchema: z.object({
    modelCallCount: z.number().default(0),
    userId: z.string().optional(),
  }),
  beforeModel: (state) => {
    if (state.modelCallCount > 10) {
      return { jumpTo: "end" };
    }
    return;
  },
  afterModel: (state) => {
    return { modelCallCount: state.modelCallCount + 1 };
  },
});

const agent = createAgent({
  model: "gpt-4o",
  tools: [...],
  middleware: [callCounterMiddleware],
});

const result = await agent.invoke({
  messages: [new HumanMessage("Hello")],
  modelCallCount: 0,
  userId: "user-123",
});
```

State fields can be either public or private. Fields that start with an underscore (`_`) are considered private and will not be included in the agent's result. Only public fields (those without a leading underscore) are returned.

This is useful for storing internal middleware state that shouldn't be exposed to the caller, such as temporary tracking variables or internal flags:

```typescript  theme={null}
const middleware = createMiddleware({
  name: "ExampleMiddleware",
  stateSchema: z.object({
    // Public field - included in invoke result
    publicCounter: z.number().default(0),
    // Private field - excluded from invoke result
    _internalFlag: z.boolean().default(false),
  }),
  afterModel: (state) => {
    // Both fields are accessible during execution
    if (state._internalFlag) {
      return { publicCounter: state.publicCounter + 1 };
    }
    return { _internalFlag: true };
  },
});

const result = await agent.invoke({
  messages: [new HumanMessage("Hello")],
  publicCounter: 0
});

// result only contains publicCounter, not _internalFlag
console.log(result.publicCounter); // 1
console.log(result._internalFlag); // undefined
```

## Custom context

Middleware can define a custom context schema to access per-invocation metadata. Unlike state, context is read-only and not persisted between invocations. This makes it ideal for:

* **User information**: Pass user ID, roles, or preferences that don't change during execution
* **Configuration overrides**: Provide per-invocation settings like rate limits or feature flags
* **Tenant/workspace context**: Include organization-specific data for multi-tenant applications
* **Request metadata**: Pass request IDs, API keys, or other metadata needed by middleware

Define a context schema using Zod and access it via `runtime.context` in middleware hooks. Required fields in the context schema will be enforced at the TypeScript level, ensuring you must provide them when calling `agent.invoke()`.

```typescript  theme={null}
import { createAgent, createMiddleware, HumanMessage } from "langchain";
import * as z from "zod";

const contextSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  apiKey: z.string().optional(),
});

const userContextMiddleware = createMiddleware({
  name: "UserContextMiddleware",
  contextSchema,
  wrapModelCall: (request, handler) => {
    // Access context from runtime
    const { userId, tenantId } = request.runtime.context;

    // Add user context to system message
    const contextText = `User ID: ${userId}, Tenant: ${tenantId}`;
    const newSystemMessage = request.systemMessage.concat(contextText);

    return handler({
      ...request,
      systemMessage: newSystemMessage,
    });
  },
});

const agent = createAgent({
  model: "gpt-4o",
  middleware: [userContextMiddleware],
  tools: [],
  contextSchema,
});

const result = await agent.invoke(
  { messages: [new HumanMessage("Hello")] },
  // Required fields (userId, tenantId) must be provided
  {
    context: {
      userId: "user-123",
      tenantId: "acme-corp",
    },
  }
);
```

**Required context fields**: When you define required fields in your `contextSchema` (fields without `.optional()` or `.default()`), TypeScript will enforce that these fields must be provided during `agent.invoke()` calls. This ensures type safety and prevents runtime errors from missing required context.

```typescript  theme={null}
// This will cause a TypeScript error if userId or tenantId are missing
const result = await agent.invoke(
  { messages: [new HumanMessage("Hello")] },
  { context: { userId: "user-123" } } // Error: tenantId is required
);
```

## Execution order

When using multiple middleware, understand how they execute:

```typescript  theme={null}
const agent = createAgent({
  model: "gpt-4o",
  middleware: [middleware1, middleware2, middleware3],
  tools: [...],
});
```

<Accordion title="Execution flow">
  **Before hooks run in order:**

  1. `middleware1.before_agent()`
  2. `middleware2.before_agent()`
  3. `middleware3.before_agent()`

  **Agent loop starts**

  4. `middleware1.before_model()`
  5. `middleware2.before_model()`
  6. `middleware3.before_model()`

  **Wrap hooks nest like function calls:**

  7. `middleware1.wrap_model_call()` → `middleware2.wrap_model_call()` → `middleware3.wrap_model_call()` → model

  **After hooks run in reverse order:**

  8. `middleware3.after_model()`
  9. `middleware2.after_model()`
  10. `middleware1.after_model()`

  **Agent loop ends**

  11. `middleware3.after_agent()`
  12. `middleware2.after_agent()`
  13. `middleware1.after_agent()`
</Accordion>

**Key rules:**

* `before_*` hooks: First to last
* `after_*` hooks: Last to first (reverse)
* `wrap_*` hooks: Nested (first middleware wraps all others)

## Agent jumps

To exit early from middleware, return a dictionary with `jump_to`:

**Available jump targets:**

* `'end'`: Jump to the end of the agent execution (or the first `after_agent` hook)
* `'tools'`: Jump to the tools node
* `'model'`: Jump to the model node (or the first `before_model` hook)

```typescript  theme={null}
import { createAgent, createMiddleware, AIMessage } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  middleware: [
    createMiddleware({
      name: "BlockedContentMiddleware",
      beforeModel: {
        canJumpTo: ["end"],
        hook: (state) => {
          if (state.messages.at(-1)?.content.includes("BLOCKED")) {
            return {
              messages: [new AIMessage("I cannot respond to that request.")],
              jumpTo: "end" as const,
            };
          }
          return;
        },
      },
    }),
  ],
});

const result = await agent.invoke({
    messages: "Hello, world! BLOCKED"
});

/**
 * Expected output:
 * I cannot respond to that request.
 */
console.log(result.messages.at(-1)?.content);
```

## Best practices

1. Keep middleware focused - each should do one thing well
2. Handle errors gracefully - don't let middleware errors crash the agent
3. **Use appropriate hook types**:
   * Node-style for sequential logic (logging, validation)
   * Wrap-style for control flow (retry, fallback, caching)
4. Clearly document any custom state properties
5. Unit test middleware independently before integrating
6. Consider execution order - place critical middleware first in the list
7. Use built-in middleware when possible

## Examples

### Dynamic model selection

```typescript  theme={null}
import { createMiddleware, initChatModel } from "langchain";

const dynamicModelMiddleware = createMiddleware({
  name: "DynamicModelMiddleware",
  wrapModelCall: (request, handler) => {
    const modifiedRequest = { ...request };
    if (request.messages.length > 10) {
      modifiedRequest.model = initChatModel("gpt-4o");
    } else {
      modifiedRequest.model = initChatModel("gpt-4o-mini");
    }
    return handler(modifiedRequest);
  },
});
```

### Tool call monitoring

```typescript  theme={null}
import { createMiddleware } from "langchain";

const toolMonitoringMiddleware = createMiddleware({
  name: "ToolMonitoringMiddleware",
  wrapToolCall: (request, handler) => {
    console.log(`Executing tool: ${request.toolCall.name}`);
    console.log(`Arguments: ${JSON.stringify(request.toolCall.args)}`);
    try {
      const result = handler(request);
      console.log("Tool completed successfully");
      return result;
    } catch (e) {
      console.log(`Tool failed: ${e}`);
      throw e;
    }
  },
});
```

### Dynamically selecting tools

Select relevant tools at runtime to improve performance and accuracy.

**Benefits:**

* **Shorter prompts** - Reduce complexity by exposing only relevant tools
* **Better accuracy** - Models choose correctly from fewer options
* **Permission control** - Dynamically filter tools based on user access

```typescript  theme={null}
import { createAgent, createMiddleware } from "langchain";

const toolSelectorMiddleware = createMiddleware({
  name: "ToolSelector",
  wrapModelCall: (request, handler) => {
    // Select a small, relevant subset of tools based on state/context
    const relevantTools = selectRelevantTools(request.state, request.runtime);
    const modifiedRequest = { ...request, tools: relevantTools };
    return handler(modifiedRequest);
  },
});

const agent = createAgent({
  model: "gpt-4o",
  tools: allTools,
  middleware: [toolSelectorMiddleware],
});
```

### Working with system messages

Modify system messages in middleware using the `systemMessage` field in `ModelRequest`. It contains a [`SystemMessage`](https://reference.langchain.com/javascript/classes/_langchain_core.messages.SystemMessage.html) object (even if the agent was created with a string [`systemPrompt`](https://reference.langchain.com/javascript/types/langchain.index.CreateAgentParams.html#systemprompt)).

**Example: Chaining middleware** - Different middleware can use different approaches:

```typescript  theme={null}
import { createMiddleware, SystemMessage, createAgent } from "langchain";

// Middleware 1: Uses systemMessage with simple concatenation
const myMiddleware = createMiddleware({
  name: "MyMiddleware",
  wrapModelCall: async (request, handler) => {
    return handler({
      ...request,
      systemMessage: request.systemMessage.concat(`Additional context.`),
    });
  },
});

// Middleware 2: Uses systemMessage with structured content (preserves structure)
const myOtherMiddleware = createMiddleware({
  name: "MyOtherMiddleware",
  wrapModelCall: async (request, handler) => {
    return handler({
      ...request,
      systemMessage: request.systemMessage.concat(
        new SystemMessage({
          content: [
            {
              type: "text",
              text: " More additional context. This will be cached.",
              cache_control: { type: "ephemeral", ttl: "5m" },
            },
          ],
        })
      ),
    });
  },
});

const agent = createAgent({
  model: "anthropic:claude-3-5-sonnet",
  systemPrompt: "You are a helpful assistant.",
  middleware: [myMiddleware, myOtherMiddleware],
});
```

The resulting system message will be:

```typescript  theme={null}
new SystemMessage({
  content: [
    { type: "text", text: "You are a helpful assistant." },
    { type: "text", text: "Additional context." },
    {
        type: "text",
        text: " More additional context. This will be cached.",
        cache_control: { type: "ephemeral", ttl: "5m" },
    },
  ],
});
```

Use [`SystemMessage.concat`](https://reference.langchain.com/javascript/classes/_langchain_core.messages.SystemMessage.html#concat) to preserve cache control metadata or structured content blocks created by other middleware.

## Additional resources

* [Middleware API reference](https://reference.langchain.com/python/langchain/middleware/)
* [Built-in middleware](/oss/javascript/langchain/middleware/built-in)
* [Testing agents](/oss/javascript/langchain/test)

***

<Callout icon="pen-to-square" iconType="regular">
  [Edit this page on GitHub](https://github.com/langchain-ai/docs/edit/main/src/oss/langchain/middleware/custom.mdx) or [file an issue](https://github.com/langchain-ai/docs/issues/new/choose).
</Callout>

<Tip icon="terminal" iconType="regular">
  [Connect these docs](/use-these-docs) to Claude, VSCode, and more via MCP for real-time answers.
</Tip>


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.langchain.com/llms.txt
