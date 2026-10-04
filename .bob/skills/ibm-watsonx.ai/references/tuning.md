# Tuning: Prompt Tuning · Fine-Tuning · InstructLab · AutoAI

Grounded in `ibm-watsonx-ai` 1.5.x. Tuning/training jobs **consume capacity
units** — confirm scope and cost before launching (see SKILL §8).

## Prompt tuning

```python
from ibm_watsonx_ai import Credentials
from ibm_watsonx_ai.experiment import TuneExperiment
from ibm_watsonx_ai.helpers import DataConnection   # training-data references

experiment = TuneExperiment(credentials, project_id="PROJECT_ID")   # or space_id=...

tuner = experiment.prompt_tuner(
    name="my prompt tuning",
    task_id=experiment.Tasks.CLASSIFICATION,        # CLASSIFICATION | GENERATION | SUMMARIZATION | ...
    base_model="google/flan-t5-xl",                 # a tuning-capable model id
    tuning_type=experiment.PromptTuningTypes.PT,    # PT (prompt tuning)
    num_epochs=6,            # 1–50
    learning_rate=0.2,       # 0.01–0.5
    accumulate_steps=32,     # 1–128
    batch_size=16,
    max_input_tokens=256,
    max_output_tokens=2,
    auto_update_model=True,
)

tuner.run(
    training_data_references=[DataConnection(data_asset_id="...")],  # or COS/connection refs
    background_mode=False,    # True = return immediately, poll later
)

status   = tuner.get_run_status()        # poll when background_mode=True
model_id = tuner.get_model_id()          # the tuned model — deploy/infer like any model
summary  = tuner.summary()               # metrics
```
- List tuning-capable base models:
  `client.foundation_models.get_model_specs_with_prompt_tuning_support()`.
- Deploy the tuned model and infer it via `ModelInference(deployment_id=...)`
  (see classic-ml-and-rest.md for deploy).

## Fine-tuning

The SDK also exposes fine-tuning experiments (full/parameter-efficient) and
**InstructLab** tuning via the `experiment` / `ilab` surfaces
(`fm_tune`, `ilab_tuner`). The shape mirrors prompt tuning:
construct an experiment → configure a tuner with a base model + data references →
`run()` → `get_model_id()`. Check the live docs for the exact tuner class and
params for your SDK version (`it_tune_experiment_run`, `ft_tune_experiment_run`,
`ilab_tuner`).

## Training-data references

Tuning/training read data via `DataConnection` objects pointing at:
- a **data asset** in the project/space (`DataConnection(data_asset_id="...")`),
- a **connection asset** (`connection_id` + location) to Cloud Object Storage or a
  database,
- (REST) `training_data_references` with `type: data_asset | connection_asset`.

## AutoAI (classic, automated ML)

```python
from ibm_watsonx_ai.experiment import AutoAI
experiment = AutoAI(credentials, project_id="PROJECT_ID")
pipeline_optimizer = experiment.optimizer(
    name="auto-classify", prediction_type=AutoAI.PredictionType.BINARY,
    prediction_column="target",
)
pipeline_optimizer.fit(training_data_references=[DataConnection(...)])
best = pipeline_optimizer.get_pipeline()        # then store/deploy via client.repository
```
AutoAI also has a RAG variant (`autoai_rag_*`) for automated RAG pattern search.
Full surface: SDK `autoai*` docs.
