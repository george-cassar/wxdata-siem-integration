# Embeddings, RAG & Other FM Tasks

Grounded in `ibm-watsonx-ai` 1.5.x. RAG classes need the extra:
`pip install "ibm-watsonx-ai[rag]"`.

## Embeddings

```python
from ibm_watsonx_ai.foundation_models import Embeddings

emb = Embeddings(
    model_id="ibm/slate-30m-english-rtrvr",   # list ids: client.foundation_models.EmbeddingModels
    api_client=client,                         # or credentials=... + project_id/space_id
    params=None,                               # optional EmbedTextParamsMetaNames dict
    batch_size=1000,                           # default
    concurrency_limit=5,                       # default; max 10
)

qvec    = emb.embed_query(text="What is AI?")            # -> list[float]
vectors = emb.embed_documents(texts=["a", "b"])          # -> list[list[float]]
raw     = emb.generate(inputs=["a", "b"])                # raw API dict
```
Params:
```python
from ibm_watsonx_ai.metanames import EmbedTextParamsMetaNames as EmbedParams
params = {EmbedParams.TRUNCATE_INPUT_TOKENS: 512,
          EmbedParams.RETURN_OPTIONS: {"input_text": True}}
```

## RAG toolkit — `foundation_models.extensions.rag`

### VectorStore
```python
from ibm_watsonx_ai.foundation_models.extensions.rag import VectorStore
vs = VectorStore(
    api_client,
    connection_id="CONNECTION_ID",     # a watsonx connection to the datasource
    index_name="my_index",
    embeddings=emb,                    # a BaseEmbeddings (e.g. Embeddings above)
    datasource_type=None,              # VectorStoreDataSourceType.*
    distance_metric="cosine",          # or "euclidean"
)
ids     = vs.add_documents(chunks)                      # -> list[str]
hits    = vs.search(query="...", k=4, include_scores=True)
windowed= vs.window_search(query="...", k=4, window_size=2)
vs.count(); vs.delete(ids); vs.clear()
```
Concrete adapters (same `BaseVectorStore` interface):
`from ibm_watsonx_ai.foundation_models.extensions.rag.vector_stores import
MilvusVectorStore, ElasticsearchVectorStore, DB2VectorStore`.

### Chunkers
```python
from ibm_watsonx_ai.foundation_models.extensions.rag.chunker import (
    LangChainChunker, HybridSemanticChunker)

chunker = LangChainChunker(method="recursive",   # "recursive" | "character" | "token"
                           chunk_size=1000, chunk_overlap=200)
chunks = chunker.split_documents(documents)

semantic = HybridSemanticChunker(embeddings=emb, chunk_size=1024)
```

### Retriever
```python
from ibm_watsonx_ai.foundation_models.extensions.rag import Retriever, RetrievalMethod
retriever = Retriever(vector_store=vs, method=RetrievalMethod.SIMPLE,   # or WINDOW
                      number_of_chunks=5, window_size=2)
docs = retriever.retrieve("a question")            # -> list[Document]
tool = retriever.to_langchain_tool()               # use as an agent tool
```

### End-to-end RAG sketch
```python
chunks = LangChainChunker(chunk_size=1000, chunk_overlap=200).split_documents(documents)
vs.add_documents(chunks)
docs    = Retriever(vector_store=vs, number_of_chunks=4).retrieve(question)
context = "\n\n".join(d.page_content for d in docs)
answer  = model.chat(messages=[
    {"role": "system", "content": "Answer only from the context."},
    {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
])["choices"][0]["message"]["content"]
```

## Other foundation-model tasks (same import root)

| Task | Class / module | Notes |
|---|---|---|
| Rerank | `foundation_models.Rerank` | reorder candidates by relevance to a query |
| Text extraction | `foundation_models.extractions` (`TextExtractions`) | extract text/structure from documents |
| Text classification | `foundation_models.classifications` | classify text |
| Moderation / guardrails | `foundation_models.moderations` | HAP / PII / Granite Guardian detectors |
| Time-series | `foundation_models.inference.TSModelInference` | forecasting models |
| Audio | `foundation_models.inference.AudioModelInference` | audio models |

LangChain / LlamaIndex bridges live under `foundation_models.extensions`
(`WatsonxLLM`, `WatsonxEmbeddings`, etc.) — see the SDK `fm_extensions_*` docs.
