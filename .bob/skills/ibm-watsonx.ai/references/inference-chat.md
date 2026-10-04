# Foundation-Model Inference & Chat

`from ibm_watsonx_ai.foundation_models import ModelInference`. Grounded in
`ibm-watsonx-ai` 1.5.x.

## Constructing `ModelInference`

```python
ModelInference(
    model_id=None,        # foundation-model id (e.g. "ibm/granite-3-3-8b-instruct")
    deployment_id=None,   # OR a deployed (tuned/custom) model's deployment id
    credentials=None,     # Credentials | dict   (or pass api_client instead)
    api_client=None,      # an initialized APIClient (preferred — reuses scope)
    params=None,          # default TextGenParameters | TextChatParameters | dict
    project_id=None,      # required if not set on the client / not using space
    space_id=None,        # alternative scope
    verify=None,          # SSL: bool | CA path
    validate=True,        # validate model_id against the service
    max_retries=None, delay_time=None, retry_status_codes=None,
)
```
Provide **either** `model_id` **or** `deployment_id`. With raw `credentials` you
must also give `project_id` or `space_id`.

## Methods

| Method | Returns | Use |
|---|---|---|
| `generate_text(prompt, params=None, guardrails=False, concurrency_limit=8, ...)` | `str` (or list for batch) | simplest path |
| `generate(prompt, params=None, async_mode=False, ...)` | raw `dict` | need full payload: `resp["results"][0]["generated_text"]` |
| `generate_text_stream(prompt, params=None, ...)` | generator of str chunks | token streaming |
| `chat(messages, params=None, tools=None, tool_choice=None, tool_choice_option=None, context=None)` | `dict` | multi-turn / system prompt / function-calling |
| `chat_stream(messages, ...)` | generator | streaming chat |
| `tokenize(prompt, return_tokens=False)` | `dict` (`result.token_count`) | count/inspect tokens |
| `get_details()` | `dict` | model metadata |
| `to_langchain()` | `WatsonxLLM` | drop into LangChain chains |

### Text generation
```python
text = model.generate_text(prompt="Summarize: ...")          # -> str
raw  = model.generate(prompt="Summarize: ...")               # -> dict
print(raw["results"][0]["generated_text"])
for chunk in model.generate_text_stream(prompt="..."):       # streaming
    print(chunk, end="", flush=True)
```
Batch: pass a `list[str]` as `prompt`; tune `concurrency_limit`.

### Chat & messages
```python
messages = [
    {"role": "system", "content": "You are concise."},
    {"role": "user", "content": "What is watsonx.ai?"},
]
resp = model.chat(messages=messages)
print(resp["choices"][0]["message"]["content"])
```
Message `content` may be a string or a list of typed parts (text/image) for
multimodal chat models.

### Tools / function-calling
```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get weather for a city",
        "parameters": {"type": "object",
                       "properties": {"city": {"type": "string"}},
                       "required": ["city"]},
    },
}]
resp = model.chat(messages=messages, tools=tools, tool_choice_option="auto")
# inspect resp["choices"][0]["message"].get("tool_calls")
```
`tool_choice_option` ∈ `"none" | "auto" | "required"`; `tool_choice` pins a
specific function.

## Parameters

**Typed (recommended):**
```python
from ibm_watsonx_ai.foundation_models.schema import TextGenParameters, TextGenDecodingMethod
params = TextGenParameters(
    decoding_method=TextGenDecodingMethod.SAMPLE,   # or GREEDY
    temperature=0.7, top_p=0.9, top_k=50,
    max_new_tokens=300, min_new_tokens=1,
    repetition_penalty=1.05,
    stop_sequences=["\n\n"],
    random_seed=42,
)
```
Chat equivalent: `TextChatParameters` (temperature, top_p, max_tokens,
frequency_penalty, presence_penalty, response_format, …).

**Dict via metanames (interchangeable):**
```python
from ibm_watsonx_ai.metanames import GenTextParamsMetaNames as GenParams
params = {GenParams.MAX_NEW_TOKENS: 300, GenParams.TEMPERATURE: 0.7,
          GenParams.DECODING_METHOD: "sample"}
```
Pass `params=` to the constructor (default for all calls) or per call (overrides).

## Guardrails (moderation)
```python
text = model.generate_text(prompt="...", guardrails=True,
                           guardrails_hap_params={"input": True, "output": True},
                           guardrails_pii_params={"input": True})
```
Off by default. There are also dedicated detector classes under
`foundation_models.moderations` (HAP/PII/Granite Guardian).

## Prompt templates
`from ibm_watsonx_ai.foundation_models.prompts import PromptTemplateManager,
PromptTemplate` — store, list, load, and parametrize reusable prompts in a
project/space; pass a stored prompt id to inference. See the SDK
`prompt_template_manager` docs for the full surface.

## Response-shape cheat-sheet
- `generate_text` → `str`
- `generate` → `{"results": [{"generated_text": ..., "generated_token_count": ...,
  "stop_reason": ...}]}`
- `chat` → `{"choices": [{"message": {"role": ..., "content": ...,
  "tool_calls": [...]}}], "usage": {...}}`
- `tokenize` → `{"result": {"token_count": N, "tokens": [...]}}`
