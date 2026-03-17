# Retrieval

Large Language Models (LLMs) are powerful, but they have two key limitations:

* **Finite context** — they can’t ingest entire corpora at once.
* **Static knowledge** — their training data is frozen at a point in time.

Retrieval addresses these problems by fetching relevant external knowledge at query time. This is the foundation of **Retrieval-Augmented Generation (RAG)**: enhancing an LLM’s answers with context-specific information.

## Building a knowledge base

A **knowledge base** is a repository of documents or structured data used during retrieval.

If you need a custom knowledge base, you can use LangChain’s document loaders and vector stores to build one from your own data.

<Note>
  If you already have a knowledge base (e.g., a SQL database, CRM, or internal documentation system), you do **not** need to rebuild it. You can:

  * Connect it as a **tool** for an agent in Agentic RAG.
  * Query it and supply the retrieved content as context to the LLM [(2-Step RAG)](#2-step-rag).
</Note>

See the following tutorial to build a searchable knowledge base and minimal RAG workflow:

<Card title="Tutorial: Semantic search" icon="database" href="/oss/javascript/langchain/knowledge-base" arrow cta="Learn more">
  Learn how to create a searchable knowledge base from your own data using LangChain’s document loaders, embeddings, and vector stores.
  In this tutorial, you’ll build a search engine over a PDF, enabling retrieval of passages relevant to a query. You’ll also implement a minimal RAG workflow on top of this engine to see how external knowledge can be integrated into LLM reasoning.
</Card>

### From retrieval to RAG

Retrieval allows LLMs to access relevant context at runtime. But most real-world applications go one step further: they **integrate retrieval with generation** to produce grounded, context-aware answers.

This is the core idea behind **Retrieval-Augmented Generation (RAG)**. The retrieval pipeline becomes a foundation for a broader system that combines search with generation.

### Retrieval pipeline

A typical retrieval workflow looks like this:

```mermaid  theme={null}
flowchart LR
  S(["Sources<br>(Google Drive, Slack, Notion, etc.)"]) --> L[Document Loaders]
  L --> A([Documents])
  A --> B[Split into chunks]
  B --> C[Turn into embeddings]
  C --> D[(Vector Store)]
  Q([User Query]) --> E[Query embedding]
  E --> D
  D --> F[Retriever]
  F --> G[LLM uses retrieved info]
  G --> H([Answer])
```

Each component is modular: you can swap loaders, splitters, embeddings, or vector stores without rewriting the app’s logic.

### Building blocks

<Columns cols={2}>
  <Card title="Document loaders" icon="file-import" href="/oss/javascript/integrations/document_loaders" arrow cta="Learn more">
    Ingest data from external sources (Google Drive, Slack, Notion, etc.), returning standardized [`Document`](https://reference.langchain.com/javascript/classes/_langchain_core.documents.Document.html) objects.
  </Card>

  <Card title="Embedding models" icon="diagram-project" href="/oss/javascript/integrations/text_embedding" arrow cta="Learn more">
    An embedding model turns text into a vector of numbers so that texts with similar meaning land close together in that vector space.
  </Card>

  <Card title="Vector stores" icon="database" href="/oss/javascript/integrations/vectorstores/" arrow cta="Learn more">
    Specialized databases for storing and searching embeddings.
  </Card>

  <Card title="Retrievers" icon="binoculars" href="/oss/javascript/integrations/retrievers/" arrow cta="Learn more">
    A retriever is an interface that returns documents given an unstructured query.
  </Card>
</Columns>

## RAG architectures

RAG can be implemented in multiple ways, depending on your system's needs. We outline each type in the sections below.

| Architecture    | Description                                                                | Control   | Flexibility | Latency    | Example Use Case                                  |
| --------------- | -------------------------------------------------------------------------- | --------- | ----------- | ---------- | ------------------------------------------------- |
| **2-Step RAG**  | Retrieval always happens before generation. Simple and predictable         | ✅ High    | ❌ Low       | ⚡ Fast     | FAQs, documentation bots                          |
| **Agentic RAG** | An LLM-powered agent decides *when* and *how* to retrieve during reasoning | ❌ Low     | ✅ High      | ⏳ Variable | Research assistants with access to multiple tools |
| **Hybrid**      | Combines characteristics of both approaches with validation steps          | ⚖️ Medium | ⚖️ Medium   | ⏳ Variable | Domain-specific Q\&A with quality validation      |

<Info>
  **Latency**: Latency is generally more **predictable** in **2-Step RAG**, as the maximum number of LLM calls is known and capped. This predictability assumes that LLM inference time is the dominant factor. However, real-world latency may also be affected by the performance of retrieval steps—such as API response times, network delays, or database queries—which can vary based on the tools and infrastructure in use.
</Info>

### 2-step RAG

In **2-Step RAG**, the retrieval step is always executed before the generation step. This architecture is straightforward and predictable, making it suitable for many applications where the retrieval of relevant documents is a clear prerequisite for generating an answer.

```mermaid  theme={null}
graph LR
    A[User Question] --> B["Retrieve Relevant Documents"]
    B --> C["Generate Answer"]
    C --> D[Return Answer to User]

    %% Styling
    classDef startend fill:#2e7d32,stroke:#1b5e20,stroke-width:2px,color:#fff
    classDef process fill:#1976d2,stroke:#0d47a1,stroke-width:1.5px,color:#fff

    class A,D startend
    class B,C process
```

<Card title="Tutorial: Retrieval-Augmented Generation (RAG)" icon="robot" href="/oss/javascript/langchain/rag#rag-chains" arrow cta="Learn more">
  See how to build a Q\&A chatbot that can answer questions grounded in your data using Retrieval-Augmented Generation.
  This tutorial walks through two approaches:

  * A **RAG agent** that runs searches with a flexible tool—great for general-purpose use.
  * A **2-step RAG** chain that requires just one LLM call per query—fast and efficient for simpler tasks.
</Card>

### Agentic RAG

**Agentic Retrieval-Augmented Generation (RAG)** combines the strengths of Retrieval-Augmented Generation with agent-based reasoning. Instead of retrieving documents before answering, an agent (powered by an LLM) reasons step-by-step and decides **when** and **how** to retrieve information during the interaction.

<Tip>
  The only thing an agent needs to enable RAG behavior is access to one or more **tools** that can fetch external knowledge — such as documentation loaders, web APIs, or database queries.
</Tip>

```mermaid  theme={null}
graph LR
    A[User Input / Question] --> B["Agent (LLM)"]
    B --> C{Need external info?}
    C -- Yes --> D["Search using tool(s)"]
    D --> H{Enough to answer?}
    H -- No --> B
    H -- Yes --> I[Generate final answer]
    C -- No --> I
    I --> J[Return to user]

    %% Dark-mode friendly styling
    classDef startend fill:#2e7d32,stroke:#1b5e20,stroke-width:2px,color:#fff
    classDef decision fill:#f9a825,stroke:#f57f17,stroke-width:2px,color:#000
    classDef process fill:#1976d2,stroke:#0d47a1,stroke-width:1.5px,color:#fff

    class A,J startend
    class B,D,I process
    class C,H decision
```

```typescript  theme={null}
import { tool, createAgent } from "langchain";

const fetchUrl = tool(
    (url: string) => {
        return `Fetched content from ${url}`;
    },
    { name: "fetch_url", description: "Fetch text content from a URL" }
);

const agent = createAgent({
    model: "claude-sonnet-4-0",
    tools: [fetchUrl],
    systemPrompt,
});
```

<Expandable title="Extended example: Agentic RAG for LangGraph's llms.txt">
  This example implements an **Agentic RAG system** to assist users in querying LangGraph documentation. The agent begins by loading [llms.txt](https://llmstxt.org/), which lists available documentation URLs, and can then dynamically use a `fetch_documentation` tool to retrieve and process the relevant content based on the user’s question.

  ```typescript  theme={null}
  import { tool, createAgent, HumanMessage } from "langchain";
  import * as z from "zod";

  const ALLOWED_DOMAINS = ["https://langchain-ai.github.io/"];
  const LLMS_TXT = "https://langchain-ai.github.io/langgraph/llms.txt";

  const fetchDocumentation = tool(
    async (input) => {  // [!code highlight]
      if (!ALLOWED_DOMAINS.some((domain) => input.url.startsWith(domain))) {
        return `Error: URL not allowed. Must start with one of: ${ALLOWED_DOMAINS.join(", ")}`;
      }
      const response = await fetch(input.url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.text();
    },
    {
      name: "fetch_documentation",
      description: "Fetch and convert documentation from a URL",
      schema: z.object({
        url: z.string().describe("The URL of the documentation to fetch"),
      }),
    }
  );

  const llmsTxtResponse = await fetch(LLMS_TXT);
  const llmsTxtContent = await llmsTxtResponse.text();

  const systemPrompt = `
  You are an expert TypeScript developer and technical assistant.
  Your primary role is to help users with questions about LangGraph and related tools.

  Instructions:

  1. If a user asks a question you're unsure about — or one that likely involves API usage,
     behavior, or configuration — you MUST use the \`fetch_documentation\` tool to consult the relevant docs.
  2. When citing documentation, summarize clearly and include relevant context from the content.
  3. Do not use any URLs outside of the allowed domain.
  4. If a documentation fetch fails, tell the user and proceed with your best expert understanding.

  You can access official documentation from the following approved sources:

  ${llmsTxtContent}

  You MUST consult the documentation to get up to date documentation
  before answering a user's question about LangGraph.

  Your answers should be clear, concise, and technically accurate.
  `;

  const tools = [fetchDocumentation];

  const agent = createAgent({
    model: "claude-sonnet-4-0"
    tools,  // [!code highlight]
    systemPrompt,  // [!code highlight]
    name: "Agentic RAG",
  });

  const response = await agent.invoke({
    messages: [
      new HumanMessage(
        "Write a short example of a langgraph agent using the " +
        "prebuilt create react agent. the agent should be able " +
        "to look up stock pricing information."
      ),
    ],
  });

  console.log(response.messages.at(-1)?.content);
  ```
</Expandable>

<Card title="Tutorial: Retrieval-Augmented Generation (RAG)" icon="robot" href="/oss/javascript/langchain/rag" arrow cta="Learn more">
  See how to build a Q\&A chatbot that can answer questions grounded in your data using Retrieval-Augmented Generation.
  This tutorial walks through two approaches:

  * A **RAG agent** that runs searches with a flexible tool—great for general-purpose use.
  * A **2-step RAG** chain that requires just one LLM call per query—fast and efficient for simpler tasks.
</Card>

### Hybrid RAG

Hybrid RAG combines characteristics of both 2-Step and Agentic RAG. It introduces intermediate steps such as query preprocessing, retrieval validation, and post-generation checks. These systems offer more flexibility than fixed pipelines while maintaining some control over execution.

Typical components include:

* **Query enhancement**: Modify the input question to improve retrieval quality. This can involve rewriting unclear queries, generating multiple variations, or expanding queries with additional context.
* **Retrieval validation**: Evaluate whether retrieved documents are relevant and sufficient. If not, the system may refine the query and retrieve again.
* **Answer validation**: Check the generated answer for accuracy, completeness, and alignment with source content. If needed, the system can regenerate or revise the answer.

The architecture often supports multiple iterations between these steps:

```mermaid  theme={null}
graph LR
    A[User Question] --> B[Query Enhancement]
    B --> C[Retrieve Documents]
    C --> D{Sufficient Info?}
    D -- No --> E[Refine Query]
    E --> C
    D -- Yes --> F[Generate Answer]
    F --> G{Answer Quality OK?}
    G -- No --> H{Try Different Approach?}
    H -- Yes --> E
    H -- No --> I[Return Best Answer]
    G -- Yes --> I
    I --> J[Return to User]

    classDef startend fill:#2e7d32,stroke:#1b5e20,stroke-width:2px,color:#fff
    classDef decision fill:#f9a825,stroke:#f57f17,stroke-width:2px,color:#000
    classDef process fill:#1976d2,stroke:#0d47a1,stroke-width:1.5px,color:#fff

    class A,J startend
    class B,C,E,F,I process
    class D,G,H decision
```

This architecture is suitable for:

* Applications with ambiguous or underspecified queries
* Systems that require validation or quality control steps
* Workflows involving multiple sources or iterative refinement

<Card title="Tutorial: Agentic RAG with Self-Correction" icon="robot" href="/oss/javascript/langgraph/agentic-rag" arrow cta="Learn more">
  An example of **Hybrid RAG** that combines agentic reasoning with retrieval and self-correction.
</Card>

***

<Callout icon="pen-to-square" iconType="regular">
  [Edit this page on GitHub](https://github.com/langchain-ai/docs/edit/main/src/oss/langchain/retrieval.mdx) or [file an issue](https://github.com/langchain-ai/docs/issues/new/choose).
</Callout>

<Tip icon="terminal" iconType="regular">
  [Connect these docs](/use-these-docs) to Claude, VSCode, and more via MCP for real-time answers.
</Tip>


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.langchain.com/llms.txt