"""The Sharp FO-70 panel's print, placed from tools/blender/fax_fo70.json: one list of what is printed where, shared by
the builder (which stores it on the fax_panel node as the glTF extra `layout`, read by src/render/fax/fo70-view.js)
and the review renders (compare_fax_fo70.py). Pure Python: no bpy.

Panel coordinates: u = x (m), w down the panel's slope from its rear edge (m). The overlay's uv runs 0..1 over
overlay.u and overlay.w, row 0 of the canvas at the rear edge.
"""


def panel_layout(J):
    pn = J["panel"]
    pr = J["print"]
    size = pr["labelSize"]
    labels = []
    for k in J["keys"]["list"]:
        if k["kind"] == "pad" or not k.get("label"):
            continue
        u, w = k["at"]
        kr = J["keys"][k["kind"]]["r"]
        lines = k["label"].count("\n") + 1
        if k["kind"] == "num":
            # The letters over the number keys stand above their key's left shoulder (the photograph).
            labels.append({"text": k["label"], "at": [round(u - 0.0058, 5), round(w - kr - 0.0013, 5)], "size": round(size * 0.85, 5)})
        else:
            # A key's name sits just above it; a two-line name stacks upward.
            labels.append({"text": k["label"], "at": [u, round(w - kr - 0.0016 - (lines - 1) * size * 0.62, 5)], "size": size})
    for it in pr["items"]:
        labels.append({"text": it["text"], "at": it["at"], "size": it["size"]})
    return {
        "overlay": {"u": pn["overlay"]["u"], "w": pn["overlay"]["w"]},
        "window": pn["window"],
        "pad": {"center": pn["pad"]["center"], "bezel": pn["pad"]["bezel"]},
        "logo": pn["logo"],
        "lcd": pn["lcd"],
        "ink": pr["labelColor"],
        "labels": labels,
    }
