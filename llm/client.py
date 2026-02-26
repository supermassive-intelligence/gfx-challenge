"""ScalarLM client using the scalarlm package."""

import logging
import multiprocessing

import scalarlm

from config import Config

log = logging.getLogger(__name__)


def _call_scalarlm(api_url, prompt, max_tokens, model_name, result_queue):
    """Run the scalarlm call in a subprocess. Puts the result or exception into the queue."""
    try:
        client = scalarlm.SupermassiveIntelligence(api_url=api_url)
        responses = client.generate(
            [prompt],
            max_tokens=max_tokens,
            model_name=model_name,
        )
        result_queue.put(("ok", responses))
    except Exception as e:
        result_queue.put(("error", f"{type(e).__name__}: {e}"))


class ScalarLMClient:
    """Talks to ScalarLM via the scalarlm package."""

    def __init__(self, config: Config) -> None:
        self.config = config

    def generate(self, prompt: str) -> str:
        """Send a generate request and return the response text.

        Runs the scalarlm call in a subprocess so we can enforce a hard timeout.
        The subprocess is terminated if ScalarLM does not respond in time.
        """
        log.info(
            "Calling ScalarLM: api_url=%s, max_tokens=%d, timeout=%ds",
            self.config.scalarlm_api_url,
            self.config.max_output_tokens,
            self.config.llm_timeout,
        )

        result_queue = multiprocessing.Queue()
        proc = multiprocessing.Process(
            target=_call_scalarlm,
            args=(
                self.config.scalarlm_api_url,
                prompt,
                self.config.max_output_tokens,
                self.config.scalarlm_model or None,
                result_queue,
            ),
        )
        proc.start()
        proc.join(timeout=self.config.llm_timeout)

        if proc.is_alive():
            # Hard kill -- the subprocess is stuck
            proc.terminate()
            proc.join(timeout=5)
            raise TimeoutError(
                f"ScalarLM did not respond within {self.config.llm_timeout}s"
            )

        if result_queue.empty():
            raise RuntimeError("ScalarLM subprocess exited without returning a result")

        status, payload = result_queue.get()
        if status == "error":
            raise RuntimeError(f"ScalarLM call failed: {payload}")

        responses = payload
        log.info("ScalarLM returned %d response(s)", len(responses) if responses else 0)
        if not responses or not responses[0]:
            raise RuntimeError(
                f"ScalarLM returned empty response. responses={responses!r}"
            )
        return responses[0]

    def close(self) -> None:
        pass
