from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("openrelik-worker-cloud-logs")
except PackageNotFoundError:  # not installed, e.g. run from a source checkout
    __version__ = "0+unknown"
