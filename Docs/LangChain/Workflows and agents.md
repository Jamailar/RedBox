# Workflows and agents

This guide reviews common workflow and agent patterns.

* Workflows have predetermined code paths and are designed to operate in a certain order.
* Agents are dynamic and define their own processes and tool usage.

<img src="https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent_workflow.png?fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=c217c9ef517ee556cae3fc928a21dc55" alt="Agent Workflow" data-og-width="4572" width="4572" data-og-height="2047" height="2047" data-path="oss/images/agent_workflow.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent_workflow.png?w=280&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=290e50cff2f72d524a107421ec8e3ff0 280w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent_workflow.png?w=560&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=a2bfc87080aee7dd4844f7f24035825e 560w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent_workflow.png?w=840&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=ae1fa9087b33b9ff8bc3446ccaa23e3d 840w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent_workflow.png?w=1100&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=06003ee1fe07d7a1ea8cf9200e7d0a10 1100w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent_workflow.png?w=1650&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=bc98b459a9b1fb226c2887de1696bde0 1650w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent_workflow.png?w=2500&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=1933bcdfd5c5b69b98ce96aafa456848 2500w" />

LangGraph offers several benefits when building agents and workflows, including [persistence](/oss/javascript/langgraph/persistence), [streaming](/oss/javascript/langgraph/streaming), and support for debugging as well as [deployment](/oss/javascript/langgraph/deploy).

## Setup

To build a workflow or agent, you can use [any chat model](/oss/javascript/integrations/chat) that supports structured outputs and tool calling. The following example uses Anthropic:

1. Install dependencies

<CodeGroup>
  ```bash npm theme={null}
  npm install @langchain/langgraph @langchain/core
  ```

  ```bash pnpm theme={null}
  pnpm add @langchain/langgraph @langchain/core
  ```

  ```bash yarn theme={null}
  yarn add @langchain/langgraph @langchain/core
  ```

  ```bash bun theme={null}
  bun add @langchain/langgraph @langchain/core
  ```
</CodeGroup>

2. Initialize the LLM:

```typescript  theme={null}
import { ChatAnthropic } from "@langchain/anthropic";

const llm = new ChatAnthropic({
  model: "claude-sonnet-4-5-20250929",
  apiKey: "<your_anthropic_key>"
});
```

## LLMs and augmentations

Workflows and agentic systems are based on LLMs and the various augmentations you add to them. [Tool calling](/oss/javascript/langchain/tools), [structured outputs](/oss/javascript/langchain/structured-output), and [short term memory](/oss/javascript/langchain/short-term-memory) are a few options for tailoring LLMs to your needs.

<img src="https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/augmented_llm.png?fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=7ea9656f46649b3ebac19e8309ae9006" alt="LLM augmentations" data-og-width="1152" width="1152" data-og-height="778" height="778" data-path="oss/images/augmented_llm.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/augmented_llm.png?w=280&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=53613048c1b8bd3241bd27900a872ead 280w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/augmented_llm.png?w=560&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=7ba1f4427fd847bd410541ae38d66d40 560w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/augmented_llm.png?w=840&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=503822cf29a28500deb56f463b4244e4 840w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/augmented_llm.png?w=1100&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=279e0440278d3a26b73c72695636272e 1100w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/augmented_llm.png?w=1650&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=d936838b98bc9dce25168e2b2cfd23d0 1650w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/augmented_llm.png?w=2500&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=fa2115f972bc1152b5e03ae590600fa3 2500w" />

```typescript  theme={null}

import * as z from "zod";
import { tool } from "langchain";

// Schema for structured output
const SearchQuery = z.object({
  search_query: z.string().describe("Query that is optimized web search."),
  justification: z
    .string()
    .describe("Why this query is relevant to the user's request."),
});

// Augment the LLM with schema for structured output
const structuredLlm = llm.withStructuredOutput(SearchQuery);

// Invoke the augmented LLM
const output = await structuredLlm.invoke(
  "How does Calcium CT score relate to high cholesterol?"
);

// Define a tool
const multiply = tool(
  ({ a, b }) => {
    return a * b;
  },
  {
    name: "multiply",
    description: "Multiply two numbers",
    schema: z.object({
      a: z.number(),
      b: z.number(),
    }),
  }
);

// Augment the LLM with tools
const llmWithTools = llm.bindTools([multiply]);

// Invoke the LLM with input that triggers the tool call
const msg = await llmWithTools.invoke("What is 2 times 3?");

// Get the tool call
console.log(msg.tool_calls);
```

## Prompt chaining

Prompt chaining is when each LLM call processes the output of the previous call. It's often used for performing well-defined tasks that can be broken down into smaller, verifiable steps. Some examples include:

* Translating documents into different languages
* Verifying generated content for consistency

<img src="https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/prompt_chain.png?fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=762dec147c31b8dc6ebb0857e236fc1f" alt="Prompt chaining" data-og-width="1412" width="1412" data-og-height="444" height="444" data-path="oss/images/prompt_chain.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/prompt_chain.png?w=280&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=fda27cf4f997e350d4ce48be16049c47 280w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/prompt_chain.png?w=560&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=1374b6de11900d394fc73722a3a6040e 560w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/prompt_chain.png?w=840&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=25246c7111a87b5df5a2af24a0181efe 840w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/prompt_chain.png?w=1100&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=0c57da86a49cf966cc090497ade347f1 1100w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/prompt_chain.png?w=1650&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=a1b5c8fc644d7a80c0792b71769c97da 1650w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/prompt_chain.png?w=2500&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=8a3f66f0e365e503a85b30be48bc1a76 2500w" />

<CodeGroup>
  ```typescript Graph API theme={null}
  import { StateGraph, StateSchema, GraphNode, ConditionalEdgeRouter } from "@langchain/langgraph";
  import { z } from "zod/v4";

  // Graph state
  const State = new StateSchema({
    topic: z.string(),
    joke: z.string(),
    improvedJoke: z.string(),
    finalJoke: z.string(),
  });

  // Define node functions

  // First LLM call to generate initial joke
  const generateJoke: GraphNode<typeof State> = async (state) => {
    const msg = await llm.invoke(`Write a short joke about ${state.topic}`);
    return { joke: msg.content };
  };

  // Gate function to check if the joke has a punchline
  const checkPunchline: ConditionalEdgeRouter<typeof State, "improveJoke"> = (state) => {
    // Simple check - does the joke contain "?" or "!"
    if (state.joke?.includes("?") || state.joke?.includes("!")) {
      return "Pass";
    }
    return "Fail";
  };

  // Second LLM call to improve the joke
  const improveJoke: GraphNode<typeof State> = async (state) => {
    const msg = await llm.invoke(
      `Make this joke funnier by adding wordplay: ${state.joke}`
    );
    return { improvedJoke: msg.content };
  };

  // Third LLM call for final polish
  const polishJoke: GraphNode<typeof State> = async (state) => {
    const msg = await llm.invoke(
      `Add a surprising twist to this joke: ${state.improvedJoke}`
    );
    return { finalJoke: msg.content };
  };

  // Build workflow
  const chain = new StateGraph(State)
    .addNode("generateJoke", generateJoke)
    .addNode("improveJoke", improveJoke)
    .addNode("polishJoke", polishJoke)
    .addEdge("__start__", "generateJoke")
    .addConditionalEdges("generateJoke", checkPunchline, {
      Pass: "improveJoke",
      Fail: "__end__"
    })
    .addEdge("improveJoke", "polishJoke")
    .addEdge("polishJoke", "__end__")
    .compile();

  // Invoke
  const state = await chain.invoke({ topic: "cats" });
  console.log("Initial joke:");
  console.log(state.joke);
  console.log("\n--- --- ---\n");
  if (state.improvedJoke !== undefined) {
    console.log("Improved joke:");
    console.log(state.improvedJoke);
    console.log("\n--- --- ---\n");

    console.log("Final joke:");
    console.log(state.finalJoke);
  } else {
    console.log("Joke failed quality gate - no punchline detected!");
  }
  ```

  ```typescript Functional API theme={null}
  import { task, entrypoint } from "@langchain/langgraph";

  // Tasks

  // First LLM call to generate initial joke
  const generateJoke = task("generateJoke", async (topic: string) => {
    const msg = await llm.invoke(`Write a short joke about ${topic}`);
    return msg.content;
  });

  // Gate function to check if the joke has a punchline
  function checkPunchline(joke: string) {
    // Simple check - does the joke contain "?" or "!"
    if (joke.includes("?") || joke.includes("!")) {
      return "Pass";
    }
    return "Fail";
  }

    // Second LLM call to improve the joke
  const improveJoke = task("improveJoke", async (joke: string) => {
    const msg = await llm.invoke(
      `Make this joke funnier by adding wordplay: ${joke}`
    );
    return msg.content;
  });

  // Third LLM call for final polish
  const polishJoke = task("polishJoke", async (joke: string) => {
    const msg = await llm.invoke(
      `Add a surprising twist to this joke: ${joke}`
    );
    return msg.content;
  });

  const workflow = entrypoint(
    "jokeMaker",
    async (topic: string) => {
      const originalJoke = await generateJoke(topic);
      if (checkPunchline(originalJoke) === "Pass") {
        return originalJoke;
      }
      const improvedJoke = await improveJoke(originalJoke);
      const polishedJoke = await polishJoke(improvedJoke);
      return polishedJoke;
    }
  );

  const stream = await workflow.stream("cats", {
    streamMode: "updates",
  });

  for await (const step of stream) {
    console.log(step);
  }
  ```
</CodeGroup>

## Parallelization

With parallelization, LLMs work simultaneously on a task. This is either done by running multiple independent subtasks at the same time, or running the same task multiple times to check for different outputs. Parallelization is commonly used to:

* Split up subtasks and run them in parallel, which increases speed
* Run tasks multiple times to check for different outputs, which increases confidence

Some examples include:

* Running one subtask that processes a document for keywords, and a second subtask to check for formatting errors
* Running a task multiple times that scores a document for accuracy based on different criteria, like the number of citations, the number of sources used, and the quality of the sources

<img src="https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/parallelization.png?fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=8afe3c427d8cede6fed1e4b2a5107b71" alt="parallelization.png" data-og-width="1020" width="1020" data-og-height="684" height="684" data-path="oss/images/parallelization.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/parallelization.png?w=280&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=88e51062b14d9186a6f0ea246bc48635 280w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/parallelization.png?w=560&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=934941ca52019b7cbce7fbdd31d00f0f 560w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/parallelization.png?w=840&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=30b5c86c545d0e34878ff0a2c367dd0a 840w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/parallelization.png?w=1100&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=6227d2c39f332eaeda23f7db66871dd7 1100w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/parallelization.png?w=1650&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=283f3ee2924a385ab88f2cbfd9c9c48c 1650w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/parallelization.png?w=2500&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=69f6a97716b38998b7b399c3d8ac7d9c 2500w" />

<CodeGroup>
  ```typescript Graph API theme={null}
  import { StateGraph, StateSchema, GraphNode } from "@langchain/langgraph";
  import * as z from "zod";

  // Graph state
  const State = new StateSchema({
    topic: z.string(),
    joke: z.string(),
    story: z.string(),
    poem: z.string(),
    combinedOutput: z.string(),
  });

  // Nodes
  // First LLM call to generate initial joke
  const callLlm1: GraphNode<typeof State> = async (state) => {
    const msg = await llm.invoke(`Write a joke about ${state.topic}`);
    return { joke: msg.content };
  };

  // Second LLM call to generate story
  const callLlm2: GraphNode<typeof State> = async (state) => {
    const msg = await llm.invoke(`Write a story about ${state.topic}`);
    return { story: msg.content };
  };

  // Third LLM call to generate poem
  const callLlm3: GraphNode<typeof State> = async (state) => {
    const msg = await llm.invoke(`Write a poem about ${state.topic}`);
    return { poem: msg.content };
  };

  // Combine the joke, story and poem into a single output
  const aggregator: GraphNode<typeof State> = async (state) => {
    const combined = `Here's a story, joke, and poem about ${state.topic}!\n\n` +
      `STORY:\n${state.story}\n\n` +
      `JOKE:\n${state.joke}\n\n` +
      `POEM:\n${state.poem}`;
    return { combinedOutput: combined };
  };

  // Build workflow
  const parallelWorkflow = new StateGraph(State)
    .addNode("callLlm1", callLlm1)
    .addNode("callLlm2", callLlm2)
    .addNode("callLlm3", callLlm3)
    .addNode("aggregator", aggregator)
    .addEdge("__start__", "callLlm1")
    .addEdge("__start__", "callLlm2")
    .addEdge("__start__", "callLlm3")
    .addEdge("callLlm1", "aggregator")
    .addEdge("callLlm2", "aggregator")
    .addEdge("callLlm3", "aggregator")
    .addEdge("aggregator", "__end__")
    .compile();

  // Invoke
  const result = await parallelWorkflow.invoke({ topic: "cats" });
  console.log(result.combinedOutput);
  ```

  ```typescript Functional API theme={null}
  import { task, entrypoint } from "@langchain/langgraph";

  // Tasks

  // First LLM call to generate initial joke
  const callLlm1 = task("generateJoke", async (topic: string) => {
    const msg = await llm.invoke(`Write a joke about ${topic}`);
    return msg.content;
  });

  // Second LLM call to generate story
  const callLlm2 = task("generateStory", async (topic: string) => {
    const msg = await llm.invoke(`Write a story about ${topic}`);
    return msg.content;
  });

  // Third LLM call to generate poem
  const callLlm3 = task("generatePoem", async (topic: string) => {
    const msg = await llm.invoke(`Write a poem about ${topic}`);
    return msg.content;
  });

  // Combine outputs
  const aggregator = task("aggregator", async (params: {
    topic: string;
    joke: string;
    story: string;
    poem: string;
  }) => {
    const { topic, joke, story, poem } = params;
    return `Here's a story, joke, and poem about ${topic}!\n\n` +
      `STORY:\n${story}\n\n` +
      `JOKE:\n${joke}\n\n` +
      `POEM:\n${poem}`;
  });

  // Build workflow
  const workflow = entrypoint(
    "parallelWorkflow",
    async (topic: string) => {
      const [joke, story, poem] = await Promise.all([
        callLlm1(topic),
        callLlm2(topic),
        callLlm3(topic),
      ]);

      return aggregator({ topic, joke, story, poem });
    }
  );

  // Invoke
  const stream = await workflow.stream("cats", {
    streamMode: "updates",
  });

  for await (const step of stream) {
    console.log(step);
  }
  ```
</CodeGroup>

## Routing

Routing workflows process inputs and then directs them to context-specific tasks. This allows you to define specialized flows for complex tasks. For example, a workflow built to answer product related questions might process the type of question first, and then route the request to specific processes for pricing, refunds, returns, etc.

<img src="https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/routing.png?fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=272e0e9b681b89cd7d35d5c812c50ee6" alt="routing.png" data-og-width="1214" width="1214" data-og-height="678" height="678" data-path="oss/images/routing.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/routing.png?w=280&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=ab85efe91d20c816f9a4e491e92a61f7 280w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/routing.png?w=560&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=769e29f9be058a47ee85e0c9228e6e44 560w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/routing.png?w=840&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=3711ee40746670731a0ce3e96b7cfeb1 840w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/routing.png?w=1100&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=9aaa28410da7643f4a2587f7bfae0f21 1100w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/routing.png?w=1650&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=6706326c7fef0511805c684d1e4f7082 1650w, https://mintcdn.com/langchain-5e9cc07a/dL5Sn6Cmy9pwtY0V/oss/images/routing.png?w=2500&fit=max&auto=format&n=dL5Sn6Cmy9pwtY0V&q=85&s=f6d603145ca33791b18c8c8afec0bb4d 2500w" />

<CodeGroup>
  ```typescript Graph API theme={null}
  import { StateGraph, StateSchema, GraphNode, ConditionalEdgeRouter } from "@langchain/langgraph";
  import * as z from "zod";

  // Schema for structured output to use as routing logic
  const routeSchema = z.object({
    step: z.enum(["poem", "story", "joke"]).describe(
      "The next step in the routing process"
    ),
  });

  // Augment the LLM with schema for structured output
  const router = llm.withStructuredOutput(routeSchema);

  // Graph state
  const State = new StateSchema({
    input: z.string(),
    decision: z.string(),
    output: z.string(),
  });

  // Nodes
  // Write a story
  const llmCall1: GraphNode<typeof State> = async (state) => {
    const result = await llm.invoke([{
      role: "system",
      content: "You are an expert storyteller.",
    }, {
      role: "user",
      content: state.input
    }]);
    return { output: result.content };
  };

  // Write a joke
  const llmCall2: GraphNode<typeof State> = async (state) => {
    const result = await llm.invoke([{
      role: "system",
      content: "You are an expert comedian.",
    }, {
      role: "user",
      content: state.input
    }]);
    return { output: result.content };
  };

  // Write a poem
  const llmCall3: GraphNode<typeof State> = async (state) => {
    const result = await llm.invoke([{
      role: "system",
      content: "You are an expert poet.",
    }, {
      role: "user",
      content: state.input
    }]);
    return { output: result.content };
  };

  const llmCallRouter: GraphNode<typeof State> = async (state) => {
    // Route the input to the appropriate node
    const decision = await router.invoke([
      {
        role: "system",
        content: "Route the input to story, joke, or poem based on the user's request."
      },
      {
        role: "user",
        content: state.input
      },
    ]);

    return { decision: decision.step };
  };

  // Conditional edge function to route to the appropriate node
  const routeDecision: ConditionalEdgeRouter<typeof State, "llmCall1" | "llmCall2" | "llmCall3"> = (state) => {
    // Return the node name you want to visit next
    if (state.decision === "story") {
      return "llmCall1";
    } else if (state.decision === "joke") {
      return "llmCall2";
    } else {
      return "llmCall3";
    }
  };

  // Build workflow
  const routerWorkflow = new StateGraph(State)
    .addNode("llmCall1", llmCall1)
    .addNode("llmCall2", llmCall2)
    .addNode("llmCall3", llmCall3)
    .addNode("llmCallRouter", llmCallRouter)
    .addEdge("__start__", "llmCallRouter")
    .addConditionalEdges(
      "llmCallRouter",
      routeDecision,
      ["llmCall1", "llmCall2", "llmCall3"],
    )
    .addEdge("llmCall1", "__end__")
    .addEdge("llmCall2", "__end__")
    .addEdge("llmCall3", "__end__")
    .compile();

  // Invoke
  const state = await routerWorkflow.invoke({
    input: "Write me a joke about cats"
  });
  console.log(state.output);
  ```

  ```typescript Functional API theme={null}
  import * as z from "zod";
  import { task, entrypoint } from "@langchain/langgraph";

  // Schema for structured output to use as routing logic
  const routeSchema = z.object({
    step: z.enum(["poem", "story", "joke"]).describe(
      "The next step in the routing process"
    ),
  });

  // Augment the LLM with schema for structured output
  const router = llm.withStructuredOutput(routeSchema);

  // Tasks
  // Write a story
  const llmCall1 = task("generateStory", async (input: string) => {
    const result = await llm.invoke([{
      role: "system",
      content: "You are an expert storyteller.",
    }, {
      role: "user",
      content: input
    }]);
    return result.content;
  });

  // Write a joke
  const llmCall2 = task("generateJoke", async (input: string) => {
    const result = await llm.invoke([{
      role: "system",
      content: "You are an expert comedian.",
    }, {
      role: "user",
      content: input
    }]);
    return result.content;
  });

  // Write a poem
  const llmCall3 = task("generatePoem", async (input: string) => {
    const result = await llm.invoke([{
      role: "system",
      content: "You are an expert poet.",
    }, {
      role: "user",
      content: input
    }]);
    return result.content;
  });

  // Route the input to the appropriate node
  const llmCallRouter = task("router", async (input: string) => {
    const decision = await router.invoke([
      {
        role: "system",
        content: "Route the input to story, joke, or poem based on the user's request."
      },
      {
        role: "user",
        content: input
      },
    ]);
    return decision.step;
  });

  // Build workflow
  const workflow = entrypoint(
    "routerWorkflow",
    async (input: string) => {
      const nextStep = await llmCallRouter(input);

      let llmCall;
      if (nextStep === "story") {
        llmCall = llmCall1;
      } else if (nextStep === "joke") {
        llmCall = llmCall2;
      } else if (nextStep === "poem") {
        llmCall = llmCall3;
      }

      const finalResult = await llmCall(input);
      return finalResult;
    }
  );

  // Invoke
  const stream = await workflow.stream("Write me a joke about cats", {
    streamMode: "updates",
  });

  for await (const step of stream) {
    console.log(step);
  }
  ```
</CodeGroup>

## Orchestrator-worker

In an orchestrator-worker configuration, the orchestrator:

* Breaks down tasks into subtasks
* Delegates subtasks to workers
* Synthesizes worker outputs into a final result

<img src="https://mintcdn.com/langchain-5e9cc07a/ybiAaBfoBvFquMDz/oss/images/worker.png?fit=max&auto=format&n=ybiAaBfoBvFquMDz&q=85&s=2e423c67cd4f12e049cea9c169ff0676" alt="worker.png" data-og-width="1486" width="1486" data-og-height="548" height="548" data-path="oss/images/worker.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/langchain-5e9cc07a/ybiAaBfoBvFquMDz/oss/images/worker.png?w=280&fit=max&auto=format&n=ybiAaBfoBvFquMDz&q=85&s=037222991ea08f889306be035c4730b6 280w, https://mintcdn.com/langchain-5e9cc07a/ybiAaBfoBvFquMDz/oss/images/worker.png?w=560&fit=max&auto=format&n=ybiAaBfoBvFquMDz&q=85&s=081f3ff05cc1fe50770c864d74084b5b 560w, https://mintcdn.com/langchain-5e9cc07a/ybiAaBfoBvFquMDz/oss/images/worker.png?w=840&fit=max&auto=format&n=ybiAaBfoBvFquMDz&q=85&s=0ef6c1b9ceb5159030aa34d0f05f1ada 840w, https://mintcdn.com/langchain-5e9cc07a/ybiAaBfoBvFquMDz/oss/images/worker.png?w=1100&fit=max&auto=format&n=ybiAaBfoBvFquMDz&q=85&s=92ec7353a89ae96e221a5a8f65c88adf 1100w, https://mintcdn.com/langchain-5e9cc07a/ybiAaBfoBvFquMDz/oss/images/worker.png?w=1650&fit=max&auto=format&n=ybiAaBfoBvFquMDz&q=85&s=71b201dd99fa234ebfb918915aac3295 1650w, https://mintcdn.com/langchain-5e9cc07a/ybiAaBfoBvFquMDz/oss/images/worker.png?w=2500&fit=max&auto=format&n=ybiAaBfoBvFquMDz&q=85&s=4f7b6e2064db575027932394a3658fbd 2500w" />

Orchestrator-worker workflows provide more flexibility and are often used when subtasks cannot be predefined the way they can with [parallelization](#parallelization). This is common with workflows that write code or need to update content across multiple files. For example, a workflow that needs to update installation instructions for multiple Python libraries across an unknown number of documents might use this pattern.

<CodeGroup>
  ```typescript Graph API theme={null}

  type SectionSchema = {
      name: string;
      description: string;
  }
  type SectionsSchema = {
      sections: SectionSchema[];
  }

  // Augment the LLM with schema for structured output
  const planner = llm.withStructuredOutput(sectionsSchema);
  ```

  ```typescript Functional API theme={null}
  import * as z from "zod";
  import { task, entrypoint } from "@langchain/langgraph";

  // Schema for structured output to use in planning
  const sectionSchema = z.object({
    name: z.string().describe("Name for this section of the report."),
    description: z.string().describe(
      "Brief overview of the main topics and concepts to be covered in this section."
    ),
  });

  const sectionsSchema = z.object({
    sections: z.array(sectionSchema).describe("Sections of the report."),
  });

  // Augment the LLM with schema for structured output
  const planner = llm.withStructuredOutput(sectionsSchema);

  // Tasks
  const orchestrator = task("orchestrator", async (topic: string) => {
    // Generate queries
    const reportSections = await planner.invoke([
      { role: "system", content: "Generate a plan for the report." },
      { role: "user", content: `Here is the report topic: ${topic}` },
    ]);

    return reportSections.sections;
  });

  const llmCall = task("sectionWriter", async (section: z.infer<typeof sectionSchema>) => {
    // Generate section
    const result = await llm.invoke([
      {
        role: "system",
        content: "Write a report section.",
      },
      {
        role: "user",
        content: `Here is the section name: ${section.name} and description: ${section.description}`,
      },
    ]);

    return result.content;
  });

  const synthesizer = task("synthesizer", async (completedSections: string[]) => {
    // Synthesize full report from sections
    return completedSections.join("\n\n---\n\n");
  });

  // Build workflow
  const workflow = entrypoint(
    "orchestratorWorker",
    async (topic: string) => {
      const sections = await orchestrator(topic);
      const completedSections = await Promise.all(
        sections.map((section) => llmCall(section))
      );
      return synthesizer(completedSections);
    }
  );

  // Invoke
  const stream = await workflow.stream("Create a report on LLM scaling laws", {
    streamMode: "updates",
  });

  for await (const step of stream) {
    console.log(step);
  }
  ```
</CodeGroup>

### Creating workers in LangGraph

Orchestrator-worker workflows are common and LangGraph has built-in support for them. The `Send` API lets you dynamically create worker nodes and send them specific inputs. Each worker has its own state, and all worker outputs are written to a shared state key that is accessible to the orchestrator graph. This gives the orchestrator access to all worker output and allows it to synthesize them into a final output. The example below iterates over a list of sections and uses the `Send` API to send a section to each worker.

```typescript  theme={null}
import { StateGraph, StateSchema, ReducedValue, GraphNode, Send } from "@langchain/langgraph";
import * as z from "zod";

// Graph state
const State = new StateSchema({
  topic: z.string(),
  sections: z.array(z.custom<SectionsSchema>()),
  completedSections: new ReducedValue(
    z.array(z.string()).default(() => []),
    { reducer: (a, b) => a.concat(b) }
  ),
  finalReport: z.string(),
});

// Worker state
const WorkerState = new StateSchema({
  section: z.custom<SectionsSchema>(),
  completedSections: new ReducedValue(
    z.array(z.string()).default(() => []),
    { reducer: (a, b) => a.concat(b) }
  ),
});

// Nodes
const orchestrator: GraphNode<typeof State> = async (state) => {
  // Generate queries
  const reportSections = await planner.invoke([
    { role: "system", content: "Generate a plan for the report." },
    { role: "user", content: `Here is the report topic: ${state.topic}` },
  ]);

  return { sections: reportSections.sections };
};

const llmCall: GraphNode<typeof WorkerState> = async (state) => {
  // Generate section
  const section = await llm.invoke([
    {
      role: "system",
      content: "Write a report section following the provided name and description. Include no preamble for each section. Use markdown formatting.",
    },
    {
      role: "user",
      content: `Here is the section name: ${state.section.name} and description: ${state.section.description}`,
    },
  ]);

  // Write the updated section to completed sections
  return { completedSections: [section.content] };
};

const synthesizer: GraphNode<typeof State> = async (state) => {
  // List of completed sections
  const completedSections = state.completedSections;

  // Format completed section to str to use as context for final sections
  const completedReportSections = completedSections.join("\n\n---\n\n");

  return { finalReport: completedReportSections };
};

// Conditional edge function to create llm_call workers that each write a section of the report
const assignWorkers: ConditionalEdgeRouter<typeof State, "llmCall"> = (state) => {
  // Kick off section writing in parallel via Send() API
  return state.sections.map((section) =>
    new Send("llmCall", { section })
  );
};

// Build workflow
const orchestratorWorker = new StateGraph(State)
  .addNode("orchestrator", orchestrator)
  .addNode("llmCall", llmCall)
  .addNode("synthesizer", synthesizer)
  .addEdge("__start__", "orchestrator")
  .addConditionalEdges(
    "orchestrator",
    assignWorkers,
    ["llmCall"]
  )
  .addEdge("llmCall", "synthesizer")
  .addEdge("synthesizer", "__end__")
  .compile();

// Invoke
const state = await orchestratorWorker.invoke({
  topic: "Create a report on LLM scaling laws"
});
console.log(state.finalReport);
```

## Evaluator-optimizer

In evaluator-optimizer workflows, one LLM call creates a response and the other evaluates that response. If the evaluator or a [human-in-the-loop](/oss/javascript/langgraph/interrupts) determines the response needs refinement, feedback is provided and the response is recreated. This loop continues until an acceptable response is generated.

Evaluator-optimizer workflows are commonly used when there's particular success criteria for a task, but iteration is required to meet that criteria. For example, there's not always a perfect match when translating text between two languages. It might take a few iterations to generate a translation with the same meaning across the two languages.

<img src="https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/evaluator_optimizer.png?fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=9bd0474f42b6040b14ed6968a9ab4e3c" alt="evaluator_optimizer.png" data-og-width="1004" width="1004" data-og-height="340" height="340" data-path="oss/images/evaluator_optimizer.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/evaluator_optimizer.png?w=280&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=ab36856e5f9a518b22e71278aa8b1711 280w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/evaluator_optimizer.png?w=560&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=3ec597c92270278c2bac203d36b611c2 560w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/evaluator_optimizer.png?w=840&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=3ad3bfb734a0e509d9b87fdb4e808bfd 840w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/evaluator_optimizer.png?w=1100&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=e82bd25a463d3cdf76036649c03358a9 1100w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/evaluator_optimizer.png?w=1650&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=d31717ae3e76243dd975a53f46e8c1f6 1650w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/evaluator_optimizer.png?w=2500&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=a9bb4fb1583f6ad06c0b13602cd14811 2500w" />

<CodeGroup>
  ```typescript Graph API theme={null}
  import { StateGraph, StateSchema, GraphNode, ConditionalEdgeRouter } from "@langchain/langgraph";
  import * as z from "zod";

  // Graph state
  const State = new StateSchema({
    joke: z.string(),
    topic: z.string(),
    feedback: z.string(),
    funnyOrNot: z.string(),
  });

  // Schema for structured output to use in evaluation
  const feedbackSchema = z.object({
    grade: z.enum(["funny", "not funny"]).describe(
      "Decide if the joke is funny or not."
    ),
    feedback: z.string().describe(
      "If the joke is not funny, provide feedback on how to improve it."
    ),
  });

  // Augment the LLM with schema for structured output
  const evaluator = llm.withStructuredOutput(feedbackSchema);

  // Nodes
  const llmCallGenerator: GraphNode<typeof State> = async (state) => {
    // LLM generates a joke
    let msg;
    if (state.feedback) {
      msg = await llm.invoke(
        `Write a joke about ${state.topic} but take into account the feedback: ${state.feedback}`
      );
    } else {
      msg = await llm.invoke(`Write a joke about ${state.topic}`);
    }
    return { joke: msg.content };
  };

  const llmCallEvaluator: GraphNode<typeof State> = async (state) => {
    // LLM evaluates the joke
    const grade = await evaluator.invoke(`Grade the joke ${state.joke}`);
    return { funnyOrNot: grade.grade, feedback: grade.feedback };
  };

  // Conditional edge function to route back to joke generator or end based upon feedback from the evaluator
  const routeJoke: ConditionalEdgeRouter<typeof State, "llmCallGenerator"> = (state) => {
    // Route back to joke generator or end based upon feedback from the evaluator
    if (state.funnyOrNot === "funny") {
      return "Accepted";
    } else {
      return "Rejected + Feedback";
    }
  };

  // Build workflow
  const optimizerWorkflow = new StateGraph(State)
    .addNode("llmCallGenerator", llmCallGenerator)
    .addNode("llmCallEvaluator", llmCallEvaluator)
    .addEdge("__start__", "llmCallGenerator")
    .addEdge("llmCallGenerator", "llmCallEvaluator")
    .addConditionalEdges(
      "llmCallEvaluator",
      routeJoke,
      {
        // Name returned by routeJoke : Name of next node to visit
        "Accepted": "__end__",
        "Rejected + Feedback": "llmCallGenerator",
      }
    )
    .compile();

  // Invoke
  const state = await optimizerWorkflow.invoke({ topic: "Cats" });
  console.log(state.joke);
  ```

  ```typescript Functional API theme={null}
  import * as z from "zod";
  import { task, entrypoint } from "@langchain/langgraph";

  // Schema for structured output to use in evaluation
  const feedbackSchema = z.object({
    grade: z.enum(["funny", "not funny"]).describe(
      "Decide if the joke is funny or not."
    ),
    feedback: z.string().describe(
      "If the joke is not funny, provide feedback on how to improve it."
    ),
  });

  // Augment the LLM with schema for structured output
  const evaluator = llm.withStructuredOutput(feedbackSchema);

  // Tasks
  const llmCallGenerator = task("jokeGenerator", async (params: {
    topic: string;
    feedback?: z.infer<typeof feedbackSchema>;
  }) => {
    // LLM generates a joke
    const msg = params.feedback
      ? await llm.invoke(
          `Write a joke about ${params.topic} but take into account the feedback: ${params.feedback.feedback}`
        )
      : await llm.invoke(`Write a joke about ${params.topic}`);
    return msg.content;
  });

  const llmCallEvaluator = task("jokeEvaluator", async (joke: string) => {
    // LLM evaluates the joke
    return evaluator.invoke(`Grade the joke ${joke}`);
  });

  // Build workflow
  const workflow = entrypoint(
    "optimizerWorkflow",
    async (topic: string) => {
      let feedback: z.infer<typeof feedbackSchema> | undefined;
      let joke: string;

      while (true) {
        joke = await llmCallGenerator({ topic, feedback });
        feedback = await llmCallEvaluator(joke);

        if (feedback.grade === "funny") {
          break;
        }
      }

      return joke;
    }
  );

  // Invoke
  const stream = await workflow.stream("Cats", {
    streamMode: "updates",
  });

  for await (const step of stream) {
    console.log(step);
    console.log("\n");
  }
  ```
</CodeGroup>

## Agents

Agents are typically implemented as an LLM performing actions using [tools](/oss/javascript/langchain/tools). They operate in continuous feedback loops, and are used in situations where problems and solutions are unpredictable. Agents have more autonomy than workflows, and can make decisions about the tools they use and how to solve problems. You can still define the available toolset and guidelines for how agents behave.

<img src="https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent.png?fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=bd8da41dbf8b5e6fc9ea6bb10cb63e38" alt="agent.png" data-og-width="1732" width="1732" data-og-height="712" height="712" data-path="oss/images/agent.png" data-optimize="true" data-opv="3" srcset="https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent.png?w=280&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=f7a590604edc49cfa273b5856f3a3ee3 280w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent.png?w=560&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=dff9b17d345fe0fea25616b3b0dc6ebf 560w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent.png?w=840&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=bd932835b919f5e58be77221b6d0f194 840w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent.png?w=1100&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=d53318b0c9c898a6146991691cbac058 1100w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent.png?w=1650&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=ea66fb96bc07c595d321b8b71e651ddb 1650w, https://mintcdn.com/langchain-5e9cc07a/-_xGPoyjhyiDWTPJ/oss/images/agent.png?w=2500&fit=max&auto=format&n=-_xGPoyjhyiDWTPJ&q=85&s=b02599a3c9ba2a5c830b9a346f9d26c9 2500w" />

<Note>
  To get started with agents, see the [quickstart](/oss/javascript/langchain/quickstart) or read more about [how they work](/oss/javascript/langchain/agents) in LangChain.
</Note>

```typescript Using tools theme={null}
import { tool } from "@langchain/core/tools";
import * as z from "zod";

// Define tools
const multiply = tool(
  ({ a, b }) => {
    return a * b;
  },
  {
    name: "multiply",
    description: "Multiply two numbers together",
    schema: z.object({
      a: z.number().describe("first number"),
      b: z.number().describe("second number"),
    }),
  }
);

const add = tool(
  ({ a, b }) => {
    return a + b;
  },
  {
    name: "add",
    description: "Add two numbers together",
    schema: z.object({
      a: z.number().describe("first number"),
      b: z.number().describe("second number"),
    }),
  }
);

const divide = tool(
  ({ a, b }) => {
    return a / b;
  },
  {
    name: "divide",
    description: "Divide two numbers",
    schema: z.object({
      a: z.number().describe("first number"),
      b: z.number().describe("second number"),
    }),
  }
);

// Augment the LLM with tools
const tools = [add, multiply, divide];
const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
const llmWithTools = llm.bindTools(tools);
```

<CodeGroup>
  ```typescript Graph API theme={null}
  import { StateGraph, StateSchema, MessagesValue, GraphNode, ConditionalEdgeRouter } from "@langchain/langgraph";
  import { ToolNode } from "@langchain/langgraph/prebuilt";
  import {
    SystemMessage,
    ToolMessage
  } from "@langchain/core/messages";

  // Graph state
  const State = new StateSchema({
    messages: MessagesValue,
  });

  // Nodes
  const llmCall: GraphNode<typeof State> = async (state) => {
    // LLM decides whether to call a tool or not
    const result = await llmWithTools.invoke([
      {
        role: "system",
        content: "You are a helpful assistant tasked with performing arithmetic on a set of inputs."
      },
      ...state.messages
    ]);

    return {
      messages: [result]
    };
  };

  const toolNode = new ToolNode(tools);

  // Conditional edge function to route to the tool node or end
  const shouldContinue: ConditionalEdgeRouter<typeof State, "toolNode"> = (state) => {
    const messages = state.messages;
    const lastMessage = messages.at(-1);

    // If the LLM makes a tool call, then perform an action
    if (lastMessage?.tool_calls?.length) {
      return "toolNode";
    }
    // Otherwise, we stop (reply to the user)
    return "__end__";
  };

  // Build workflow
  const agentBuilder = new StateGraph(State)
    .addNode("llmCall", llmCall)
    .addNode("toolNode", toolNode)
    // Add edges to connect nodes
    .addEdge("__start__", "llmCall")
    .addConditionalEdges(
      "llmCall",
      shouldContinue,
      ["toolNode", "__end__"]
    )
    .addEdge("toolNode", "llmCall")
    .compile();

  // Invoke
  const messages = [{
    role: "user",
    content: "Add 3 and 4."
  }];
  const result = await agentBuilder.invoke({ messages });
  console.log(result.messages);
  ```

  ```typescript Functional API theme={null}
  import { task, entrypoint, addMessages } from "@langchain/langgraph";
  import { BaseMessageLike, ToolCall } from "@langchain/core/messages";

  const callLlm = task("llmCall", async (messages: BaseMessageLike[]) => {
    // LLM decides whether to call a tool or not
    return llmWithTools.invoke([
      {
        role: "system",
        content: "You are a helpful assistant tasked with performing arithmetic on a set of inputs."
      },
      ...messages
    ]);
  });

  const callTool = task("toolCall", async (toolCall: ToolCall) => {
    // Performs the tool call
    const tool = toolsByName[toolCall.name];
    return tool.invoke(toolCall.args);
  });

  const agent = entrypoint(
    "agent",
    async (messages) => {
      let llmResponse = await callLlm(messages);

      while (true) {
        if (!llmResponse.tool_calls?.length) {
          break;
        }

        // Execute tools
        const toolResults = await Promise.all(
          llmResponse.tool_calls.map((toolCall) => callTool(toolCall))
        );

        messages = addMessages(messages, [llmResponse, ...toolResults]);
        llmResponse = await callLlm(messages);
      }

      messages = addMessages(messages, [llmResponse]);
      return messages;
    }
  );

  // Invoke
  const messages = [{
    role: "user",
    content: "Add 3 and 4."
  }];

  const stream = await agent.stream([messages], {
    streamMode: "updates",
  });

  for await (const step of stream) {
    console.log(step);
  }
  ```
</CodeGroup>

***

<Callout icon="pen-to-square" iconType="regular">
  [Edit this page on GitHub](https://github.com/langchain-ai/docs/edit/main/src/oss/langgraph/workflows-agents.mdx) or [file an issue](https://github.com/langchain-ai/docs/issues/new/choose).
</Callout>

<Tip icon="terminal" iconType="regular">
  [Connect these docs](/use-these-docs) to Claude, VSCode, and more via MCP for real-time answers.
</Tip>


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.langchain.com/llms.txt
