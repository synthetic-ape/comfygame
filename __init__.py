"""ComfyGame: turn ComfyUI into a game engine. https://github.com/ (see README.md)"""
from comfy_api.latest import ComfyExtension, io

from .comfygame import routes
from .comfygame.nodes import NODES

WEB_DIRECTORY = "./web"


class ComfyGameExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return NODES


async def comfy_entrypoint() -> ComfyGameExtension:
    return ComfyGameExtension()


routes.register()

__all__ = ["comfy_entrypoint", "WEB_DIRECTORY"]
