import os

from aiohttp import web

import folder_paths
from comfy_api.latest import InputImpl
from server import PromptServer

WEB_DIRECTORY = "./web"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["WEB_DIRECTORY", "NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]


def _resolve_view_file(query) -> str | None:
    """The file `/view` would serve for the same query, with its path checks."""
    filename, base = folder_paths.annotated_filepath(query.get("filename", ""))
    if not filename or filename[0] == "/" or ".." in filename:
        return None
    base = base or folder_paths.get_directory_by_type(query.get("type", "output"))
    if base is None:
        return None
    directory = os.path.join(base, query.get("subfolder", ""))
    if os.path.commonpath((os.path.abspath(directory), base)) != base:
        return None
    path = os.path.join(directory, os.path.basename(filename))
    return path if os.path.isfile(path) else None


@PromptServer.instance.routes.get("/nodes2classic/video_meta")
async def video_meta(request):
    """Container fps/duration/size for the canvas video editors, as the trim nodes read them."""
    path = _resolve_view_file(request.rel_url.query)
    if path is None:
        return web.Response(status=404)
    video = InputImpl.VideoFromFile(path)
    width, height = video.get_dimensions()
    return web.json_response({
        "fps": float(video.get_frame_rate()),
        "duration": video.get_duration(),
        "width": width,
        "height": height,
        "size": os.path.getsize(path),
    })
