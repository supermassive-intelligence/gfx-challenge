"""Docker container lifecycle management for game sandboxes."""

import logging
import tempfile
import time
from pathlib import Path

import docker
from docker.errors import NotFound

from config import Config

log = logging.getLogger(__name__)


class GameSandbox:
    """Manages Docker containers that serve generated HTML games via nginx."""

    CONTAINER_PREFIX = "gfx-challenge-game-"

    def __init__(self, config: Config) -> None:
        self.config = config
        self._client = docker.from_env()
        self._containers: dict[str, dict] = {}  # game_id -> {container, port, tmp_dir}

    def serve_game(self, game_id: str, html_content: str) -> int:
        """Start an nginx container serving the given HTML. Returns the host port."""
        # Write HTML to a temp directory
        tmp_dir = tempfile.mkdtemp(prefix=f"gfx-{game_id}-")
        html_path = Path(tmp_dir) / "index.html"
        html_path.write_text(html_content, encoding="utf-8")

        container_name = f"{self.CONTAINER_PREFIX}{game_id}"

        # Stop existing container for this game_id if any
        self._stop_container(container_name)

        container = self._client.containers.run(
            image=self.config.sandbox_image,
            name=container_name,
            detach=True,
            ports={"8080/tcp": None},  # auto-assign host port
            volumes={tmp_dir: {"bind": "/usr/share/nginx/html", "mode": "ro"}},
            mem_limit=self.config.sandbox_memory_limit,
            read_only=False,  # nginx needs to write pid/cache, but html mount is ro
            labels={"managed-by": "gfx-challenge"},
        )

        # Wait for port mapping (container may need a moment to initialize)
        port_info = None
        for _ in range(10):
            container.reload()
            port_info = container.ports.get("8080/tcp")
            if port_info:
                break
            time.sleep(0.3)
        if not port_info:
            raise RuntimeError(f"No port mapping found for container {container_name}")
        host_port = int(port_info[0]["HostPort"])

        self._containers[game_id] = {
            "container": container,
            "port": host_port,
            "tmp_dir": tmp_dir,
        }

        log.info("Game %s serving on port %d", game_id, host_port)
        return host_port

    def stop_game(self, game_id: str) -> None:
        """Stop and remove the container for a given game."""
        info = self._containers.pop(game_id, None)
        if info:
            container_name = f"{self.CONTAINER_PREFIX}{game_id}"
            self._stop_container(container_name)

    def cleanup_all(self) -> None:
        """Stop all managed containers."""
        for game_id in list(self._containers.keys()):
            self.stop_game(game_id)
        # Also clean up any orphaned containers from previous runs
        try:
            containers = self._client.containers.list(
                filters={"label": "managed-by=gfx-challenge"}
            )
            for c in containers:
                log.info("Cleaning up orphaned container %s", c.name)
                c.stop(timeout=5)
                c.remove()
        except Exception as e:
            log.warning("Error during orphan cleanup: %s", e)

    def get_port(self, game_id: str) -> int | None:
        """Get the host port for a running game, or None."""
        info = self._containers.get(game_id)
        return info["port"] if info else None

    def _stop_container(self, container_name: str) -> None:
        try:
            existing = self._client.containers.get(container_name)
            existing.stop(timeout=5)
            existing.remove()
        except NotFound:
            pass
        except Exception as e:
            log.warning("Error stopping container %s: %s", container_name, e)
