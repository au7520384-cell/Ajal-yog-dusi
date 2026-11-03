"""Real-ESRGAN "general x4 v3" (SRVGGNetCompact, BSD-3, github.com/xinntao/Real-ESRGAN) on the CPU with onnxruntime, without torch.
The weights (.pth, 4.9 MB) are read with a tiny unpickler, turned into an ONNX graph here and run by onnxruntime (pip install onnx onnxruntime pillow numpy).
    from esrgan import Upscaler;  up = Upscaler();  big = up.x4(pil_rgb_image)      # 4x bigger, RGB
Alpha is handled by the caller (upscale the alpha channel as a plain picture, see upscale_rgba())."""
import io, os, pickle, zipfile, urllib.request
import numpy as np
from PIL import Image

URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"
CACHE = os.environ.get("ESRGAN_CACHE", os.path.join(os.path.expanduser("~"), ".cache", "esrgan"))


def _load_pth(path):
    """The weights of a torch checkpoint as numpy arrays (no torch needed)."""
    z = zipfile.ZipFile(path)
    names = z.namelist()
    pkl = next(n for n in names if n.endswith("/data.pkl") or n == "data.pkl")
    root = pkl[: -len("data.pkl")]
    class Storage:
        def __init__(self, dtype): self.dtype = dtype
    def rebuild(storage, offset, size, stride, *a):
        raw = np.frombuffer(z.read(root + "data/" + storage["key"]), dtype=storage["dtype"])
        n = int(np.prod(size)) if len(size) else 1
        return raw[offset: offset + n].reshape(size).copy()
    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if name == "_rebuild_tensor_v2": return rebuild
            if name.endswith("Storage"): return {"FloatStorage": np.float32, "HalfStorage": np.float16, "DoubleStorage": np.float64}[name]
            if mod == "collections" and name == "OrderedDict": import collections; return collections.OrderedDict
            return super().find_class(mod, name)
        def persistent_load(self, pid):   # ('storage', FloatStorage, key, location, numel)
            return {"dtype": pid[1], "key": pid[2]}
    d = U(io.BytesIO(z.read(pkl))).load()
    return d.get("params_ema", d.get("params", d))


def _graph(w):
    import onnx
    from onnx import helper as h, numpy_helper as nh, TensorProto as T
    nodes, inits = [], []
    def init(name, arr): inits.append(nh.from_array(np.asarray(arr, dtype=np.float32), name)); return name
    cur = "x"; i = 0
    nconv = sum(1 for k in w if k.endswith(".weight") and w[k].ndim == 4)
    k = 0; idx = 0
    while f"body.{idx}.weight" in w:
        W = w[f"body.{idx}.weight"]
        if W.ndim == 4:
            out = f"c{idx}"
            nodes.append(h.make_node("Conv", [cur, init(f"w{idx}", W), init(f"b{idx}", w[f"body.{idx}.bias"])], [out], pads=[1, 1, 1, 1], kernel_shape=[3, 3]))
            cur = out
        else:   # PReLU: one slope per channel
            out = f"p{idx}"
            nodes.append(h.make_node("PRelu", [cur, init(f"s{idx}", W.reshape(-1, 1, 1))], [out]))
            cur = out
        idx += 1
    scale = int(round((w[f"body.{idx - 1}.weight"].shape[0] / 3) ** 0.5))
    nodes.append(h.make_node("DepthToSpace", [cur], ["ps"], blocksize=scale, mode="CRD"))
    nodes.append(h.make_node("Constant", [], ["scales"], value=nh.from_array(np.array([1, 1, scale, scale], dtype=np.float32))))
    nodes.append(h.make_node("Resize", ["x", "", "scales"], ["base"], mode="nearest", nearest_mode="floor", coordinate_transformation_mode="asymmetric"))
    nodes.append(h.make_node("Add", ["ps", "base"], ["y"]))
    g = h.make_graph(nodes, "srvgg", [h.make_tensor_value_info("x", T.FLOAT, [1, 3, "H", "W"])], [h.make_tensor_value_info("y", T.FLOAT, [1, 3, "H4", "W4"])], inits)
    m = h.make_model(g, opset_imports=[h.make_opsetid("", 13)]); m.ir_version = 8
    return m.SerializeToString(), scale


class Upscaler:
    def __init__(self, weights=None, threads=None):
        import onnxruntime as ort
        weights = weights or os.path.join(CACHE, "realesr-general-x4v3.pth")
        if not os.path.exists(weights):
            os.makedirs(os.path.dirname(weights), exist_ok=True); urllib.request.urlretrieve(URL, weights)
        blob, self.scale = _graph(_load_pth(weights))
        so = ort.SessionOptions()
        threads = threads or int(os.environ.get("ESRGAN_THREADS", "0")) or None
        if threads: so.intra_op_num_threads = threads
        self.s = ort.InferenceSession(blob, so, providers=["CPUExecutionProvider"])

    def run(self, rgb, tile=256, pad=10):
        """rgb: PIL RGB image -> PIL RGB image, `scale` times bigger (big pictures are cut into overlapping tiles)."""
        a = np.asarray(rgb.convert("RGB"), dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
        _, _, H, W = a.shape; S = self.scale
        if H <= tile and W <= tile:
            y = self.s.run(None, {"x": a})[0]
        else:
            y = np.zeros((1, 3, H * S, W * S), dtype=np.float32)
            for ty in range(0, H, tile):
                for tx in range(0, W, tile):
                    y0, y1, x0, x1 = max(0, ty - pad), min(H, ty + tile + pad), max(0, tx - pad), min(W, tx + tile + pad)
                    o = self.s.run(None, {"x": np.ascontiguousarray(a[:, :, y0:y1, x0:x1])})[0]
                    oy, ox = (ty - y0) * S, (tx - x0) * S; hh, ww = min(tile, H - ty) * S, min(tile, W - tx) * S
                    y[:, :, ty * S: ty * S + hh, tx * S: tx * S + ww] = o[:, :, oy: oy + hh, ox: ox + ww]
        y = np.clip(y[0].transpose(1, 2, 0) * 255.0 + 0.5, 0, 255).astype(np.uint8)
        return Image.fromarray(y, "RGB")

    x4 = run


def _fill_transparent(im, rounds=8):
    """Colour for the transparent pixels = the mean colour of the nearest visible ones (dilation by blurring), so the network does not see a black / white fringe at the edge."""
    from PIL import ImageFilter
    arr = np.asarray(im.convert("RGBA")); known = arr[..., 3] > 127
    chans = [Image.fromarray(np.where(known, arr[..., c], 0).astype(np.uint8), "L") for c in range(3)]
    kn = Image.fromarray((known * 255).astype(np.uint8), "L")
    out = arr[..., :3].astype(np.float32).copy(); have = known.copy()
    for r in range(rounds):
        rad = 2 + 2 * r
        bk = np.asarray(kn.filter(ImageFilter.BoxBlur(rad)), dtype=np.float32) / 255.0
        take = (~have) & (bk > 0.02)
        for c in range(3):
            bc = np.asarray(chans[c].filter(ImageFilter.BoxBlur(rad)), dtype=np.float32)   # colour * known, blurred (0..255)
            out[..., c] = np.where(take, bc / np.maximum(bk, 0.02), out[..., c])
        have |= take
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def upscale_rgba(up, im):
    """RGBA picture: the colour goes through the network (transparent pixels first filled with the neighbouring colour), the alpha is resized smoothly."""
    im = im.convert("RGBA"); W, H = im.size; S = up.scale
    a = im.getchannel("A")
    if a.getextrema()[0] == 255: return up.run(im.convert("RGB")).convert("RGBA")
    big = up.run(_fill_transparent(im))
    big.putalpha(a.resize((W * S, H * S), Image.LANCZOS))
    return big
