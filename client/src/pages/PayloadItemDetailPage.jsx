import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchItem, updatePayloadItem, uploadItemMedia, detachItemMedia } from "../services/payloadApi.js";
import { listScenes, generateWithScene, removeBackground, processServiceImage } from "../services/api.js";
import RichTextEditor from "../components/RichTextEditor.jsx";
import ItemPreviewComposite from "../components/ItemPreviewComposite.jsx";
import ModeSelector from "../components/ModeSelector.jsx";
import FormatSelector from "../components/FormatSelector.jsx";
import LogoPositionGrid from "../components/LogoPositionGrid.jsx";
import { validateImageFile, createPreviewUrl, revokePreviewUrl } from "../utils/fileHelpers.js";
import { COMPOSITION_DEFAULTS, LIGHTING_DEFAULTS } from "../../../shared/constants/imageRules.js";
import config from "../config.js";

const PAYLOAD_BASE = "https://www.attic-tech.com";

function resolveMediaUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${PAYLOAD_BASE}${url}`;
}

function extractMediaList(item) {
  const raw = item?.media;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .filter((m) => m && (m.url || m.sizes?.thumbnail?.url))
    .map((m) => ({
      id: m.id,
      url: resolveMediaUrl(m.url),
      thumbUrl: resolveMediaUrl(m.sizes?.thumbnail?.url || m.url),
      filename: m.filename || "",
    }));
}

async function fetchGeneratedFile(imageUrl, filename) {
  const url = imageUrl.startsWith("http") ? imageUrl : `${config.API_BASE_URL}/../${imageUrl.replace(/^\//, "")}`;
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], filename || "generated.png", { type: blob.type });
}

function LightingSlider({ label, value, min, max, step, onChange }) {
  return (
    <div className="service-lighting__slider">
      <label>{label}: <strong>{value.toFixed(2)}</strong></label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

function buildCssFilter(lighting) {
  let f = `brightness(${lighting.brightness}) contrast(${lighting.contrast}) saturate(${lighting.saturation})`;
  if (lighting.warmth > 0) f += ` sepia(${lighting.warmth * 0.25})`;
  if (lighting.warmth < 0) f += ` hue-rotate(${lighting.warmth * 15}deg)`;
  return f;
}

export default function PayloadItemDetailPage() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const [mediaList, setMediaList] = useState([]);
  const [selectedMedia, setSelectedMedia] = useState(0);
  const [uploading, setUploading] = useState(false);

  const [detaching, setDetaching] = useState(null);

  // ── Catalog generator state ──
  const [scenes, setScenes] = useState([]);
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [selectedScene, setSelectedScene] = useState(null);
  const [genItemFile, setGenItemFile] = useState(null);
  const [genItemPreview, setGenItemPreview] = useState(null);
  const [transparentUrl, setTransparentUrl] = useState(null);
  const [removingBg, setRemovingBg] = useState(false);
  const [itemScale, setItemScale] = useState(COMPOSITION_DEFAULTS.itemScale);
  const [shadowIntensity, setShadowIntensity] = useState(1);
  const [genMode, setGenMode] = useState("quick");
  const [genFormat, setGenFormat] = useState("square");
  const [genInstruction, setGenInstruction] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [uploadingGen, setUploadingGen] = useState(false);
  const genItemRef = useRef(null);

  // ── Service photo state ──
  const [showService, setShowService] = useState(false);
  const [svcLogoFile, setSvcLogoFile] = useState(null);
  const [svcLogoPreview, setSvcLogoPreview] = useState(null);
  const [svcPhotoFile, setSvcPhotoFile] = useState(null);
  const [svcPhotoPreview, setSvcPhotoPreview] = useState(null);
  const [svcLogoPosition, setSvcLogoPosition] = useState("bottom-right");
  const [svcLogoScale, setSvcLogoScale] = useState(COMPOSITION_DEFAULTS.logoScale);
  const [svcFormat, setSvcFormat] = useState("square");
  const [svcLighting, setSvcLighting] = useState({ ...LIGHTING_DEFAULTS });
  const [svcProcessing, setSvcProcessing] = useState(false);
  const [svcResult, setSvcResult] = useState(null);
  const [uploadingSvc, setUploadingSvc] = useState(false);
  const svcPhotoRef = useRef(null);
  const svcLogoRef = useRef(null);

  // ── Load item ──
  const loadItem = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchItem(itemId);
      const data = res.data || res;
      setItem(data);
      setName(data.name || "");
      setDescription(data.itemInfo || "");
      setDirty(false);
      setMediaList(extractMediaList(data));
      setSelectedMedia(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { loadItem(); }, [loadItem]);

  useEffect(() => {
    (async () => {
      try {
        const res = await listScenes();
        setScenes(res.data || []);
      } catch { /* not critical */ }
    })();
  }, []);

  useEffect(() => {
    setSelectedScene(selectedSceneId ? scenes.find((s) => s.id === selectedSceneId) || null : null);
  }, [selectedSceneId, scenes]);

  const showSaved = (msg) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(""), 3000);
  };

  // ── Item data save ──
  const handleSave = async () => {
    setSaving(true);
    setSavedMsg("");
    try {
      await updatePayloadItem(itemId, { name, description });
      setDirty(false);
      showSaved("Saved successfully");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  // ── Direct image upload ──
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadItemMedia(itemId, file);
      await loadItem();
    } catch (err) { setError(err.message); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Detach image from item ──
  const handleDetachMedia = async (mediaId) => {
    if (!confirm("Remove this image from the item? (The image won't be deleted from the system)")) return;
    setDetaching(mediaId);
    setError(null);
    try {
      await detachItemMedia(itemId, mediaId);
      await loadItem();
    } catch (err) { setError(err.message); }
    finally { setDetaching(null); }
  };

  // ── Upload any generated image to Payload ──
  const uploadGeneratedToPayload = async (imageUrl, filename) => {
    const file = await fetchGeneratedFile(imageUrl, filename);
    await uploadItemMedia(itemId, file);
    await loadItem();
    showSaved("Image uploaded to Payload");
  };

  // ══════════════════════════════════════
  // CATALOG GENERATOR
  // ══════════════════════════════════════

  const handleGenItemSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setError(err); return; }
    setError(null);
    if (genItemPreview) revokePreviewUrl(genItemPreview);
    setGenItemFile(file);
    setGenItemPreview(createPreviewUrl(file));
    setTransparentUrl(null);
    setGenResult(null);
    setItemScale(COMPOSITION_DEFAULTS.itemScale);
    e.target.value = "";

    setRemovingBg(true);
    try {
      const res = await removeBackground(file);
      setTransparentUrl(res.data.imageUrl);
    } catch (bgErr) {
      setError("Background removal failed: " + bgErr.message);
    } finally {
      setRemovingBg(false);
    }
  }, [genItemPreview]);

  const handleGenerate = async () => {
    if (!genItemFile || !selectedSceneId) return;
    setGenerating(true);
    setError(null);
    setGenResult(null);
    try {
      const res = await generateWithScene({
        sceneId: selectedSceneId,
        item: genItemFile,
        itemName: name,
        instruction: genInstruction,
        logoPosition: selectedScene?.logoPosition,
        mode: genMode,
        format: genFormat,
        itemScale,
        shadowIntensity,
      });
      setGenResult(res.data);
    } catch (err) { setError(err.message); }
    finally { setGenerating(false); }
  };

  const handleUploadGenerated = async () => {
    if (!genResult?.imageUrl) return;
    setUploadingGen(true);
    setError(null);
    try {
      await uploadGeneratedToPayload(genResult.imageUrl, genResult.filename);
      setGenResult(null);
    } catch (err) { setError(err.message); }
    finally { setUploadingGen(false); }
  };

  const resetGenerator = () => {
    if (genItemPreview) revokePreviewUrl(genItemPreview);
    setGenItemFile(null);
    setGenItemPreview(null);
    setTransparentUrl(null);
    setGenResult(null);
    setItemScale(COMPOSITION_DEFAULTS.itemScale);
    setShadowIntensity(1);
    setGenInstruction("");
  };

  // ══════════════════════════════════════
  // SERVICE PHOTO GENERATOR
  // ══════════════════════════════════════

  const handleSvcLogoSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setError(err); return; }
    if (svcLogoPreview) revokePreviewUrl(svcLogoPreview);
    setSvcLogoFile(file);
    setSvcLogoPreview(createPreviewUrl(file));
    e.target.value = "";
  }, [svcLogoPreview]);

  const handleSvcPhotoSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setError(err); return; }
    if (svcPhotoPreview) revokePreviewUrl(svcPhotoPreview);
    setSvcPhotoFile(file);
    setSvcPhotoPreview(createPreviewUrl(file));
    setSvcResult(null);
    e.target.value = "";
  }, [svcPhotoPreview]);

  const handleSvcProcess = async () => {
    if (!svcPhotoFile || !svcLogoFile) return;
    setSvcProcessing(true);
    setError(null);
    try {
      const res = await processServiceImage({
        photo: svcPhotoFile,
        logo: svcLogoFile,
        format: svcFormat,
        lighting: svcLighting,
        logoPosition: svcLogoPosition,
        logoScale: svcLogoScale,
      });
      setSvcResult(res.data);
    } catch (err) { setError(err.message); }
    finally { setSvcProcessing(false); }
  };

  const handleUploadSvc = async () => {
    if (!svcResult?.imageUrl) return;
    setUploadingSvc(true);
    setError(null);
    try {
      await uploadGeneratedToPayload(svcResult.imageUrl, svcResult.filename);
      setSvcResult(null);
    } catch (err) { setError(err.message); }
    finally { setUploadingSvc(false); }
  };

  const updateSvcLighting = useCallback((key, val) => {
    setSvcLighting((prev) => ({ ...prev, [key]: val }));
  }, []);

  const resetService = () => {
    if (svcPhotoPreview) revokePreviewUrl(svcPhotoPreview);
    setSvcPhotoFile(null);
    setSvcPhotoPreview(null);
    setSvcResult(null);
    setSvcLighting({ ...LIGHTING_DEFAULTS });
  };

  // ── Render guards ──
  if (loading) return <main className="page"><p>Loading item...</p></main>;

  if (error && !item) {
    return (
      <main className="page">
        <button className="btn btn--link" onClick={() => navigate(-1)}>Back</button>
        <div className="error-banner">
          <span className="error-banner__icon">!</span>
          <span className="error-banner__message">{error}</span>
        </div>
      </main>
    );
  }

  const currentImage = mediaList[selectedMedia]?.url || null;
  const categoryName = item?.category?.title || item?.category?.name || "";
  const svcCssFilter = buildCssFilter(svcLighting);

  return (
    <main className="page">
      <button className="btn btn--link" onClick={() => navigate("/items")}>Back to Items</button>

      {error && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          <span className="error-banner__icon">!</span>
          <span className="error-banner__message">{error}</span>
        </div>
      )}

      {/* ════════ ITEM INFO ════════ */}
      <div className="payload-detail">
        <div className="payload-detail__images">
          <div className="payload-detail__main-img-wrap">
            {currentImage ? (
              <img className="payload-detail__main-img" src={currentImage} alt={name || "Item"} />
            ) : (
              <div className="payload-detail__no-image">No images available</div>
            )}
          </div>
          {mediaList.length > 0 && (
            <div className="payload-detail__thumbs">
              {mediaList.map((m, idx) => (
                <div key={m.id} className="payload-detail__thumb-wrap">
                  <img
                    src={m.thumbUrl}
                    alt={m.filename}
                    className={`payload-detail__thumb ${idx === selectedMedia ? "payload-detail__thumb--active" : ""}`}
                    onClick={() => setSelectedMedia(idx)}
                  />
                  <button
                    className="payload-detail__thumb-remove"
                    title="Remove from item"
                    disabled={detaching === m.id}
                    onClick={(e) => { e.stopPropagation(); handleDetachMedia(m.id); }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="payload-detail__editor">
          {categoryName && (
            <div className="payload-detail__field">
              <label className="payload-detail__label">Category</label>
              <div className="payload-detail__readonly">{categoryName}</div>
            </div>
          )}

          <div className="payload-detail__field">
            <label className="payload-detail__label">Item Name</label>
            <input className="payload-detail__input" type="text" value={name} placeholder="Enter item name"
              onChange={(e) => { setName(e.target.value); setDirty(true); }} />
          </div>

          <div className="payload-detail__field">
            <label className="payload-detail__label">Description</label>
            <RichTextEditor content={description} onChange={(html) => { setDescription(html); setDirty(true); }} />
          </div>

          {item?.unit && (
            <div className="payload-detail__field">
              <label className="payload-detail__label">Unit</label>
              <div className="payload-detail__readonly">{item.unit}</div>
            </div>
          )}
          {item?.materialCost != null && (
            <div className="payload-detail__field">
              <label className="payload-detail__label">Material Cost</label>
              <div className="payload-detail__readonly">${Number(item.materialCost).toFixed(2)}</div>
            </div>
          )}

          <div className="payload-detail__actions">
            <button className="btn btn--primary" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? "Saving..." : "Save to Payload"}
            </button>
            <button className="btn btn--secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading..." : "Upload Image"}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} />
            {savedMsg && <span className="payload-detail__saved-msg">{savedMsg}</span>}
          </div>

          {item?.updatedAt && (
            <div className="payload-detail__meta">
              <div className="payload-detail__meta-row">
                <span>Last updated</span>
                <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ════════ CATALOG GENERATOR ════════ */}
      <div className="gen-section">
        <button className="gen-section__toggle" onClick={() => setShowGenerator(!showGenerator)}>
          <span className="gen-section__toggle-icon">{showGenerator ? "▾" : "▸"}</span>
          Generate Catalog Image with Scene
        </button>

        {showGenerator && (
          <div className="gen-section__body">
            {/* Scene selector */}
            <div className="gen-section__field" style={{ marginBottom: 20, maxWidth: 400 }}>
              <label className="payload-detail__label">Scene</label>
              <select className="payload-detail__input" value={selectedSceneId} onChange={(e) => setSelectedSceneId(e.target.value)}>
                <option value="">Select a scene...</option>
                {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {selectedScene && (
              <div className="gen-section__scene-preview">
                <img src={selectedScene.backgroundUrl} alt={selectedScene.name} />
                {selectedScene.logoUrl && (
                  <img
                    className={`scene-preview__logo-overlay scene-preview__logo--${selectedScene.logoPosition || "bottom-right"}`}
                    src={selectedScene.logoUrl}
                    alt="Logo"
                  />
                )}
              </div>
            )}

            <ModeSelector value={genMode} onChange={setGenMode} />
            <FormatSelector value={genFormat} onChange={setGenFormat} />

            {genMode !== "quick" && (
              <div className="options-row">
                <div className="input-group">
                  <label className="input-group__label" htmlFor="gen-instruction">Extra Instructions (optional)</label>
                  <input id="gen-instruction" className="input-group__input" type="text"
                    placeholder="e.g. Place item on the left side"
                    value={genInstruction} onChange={(e) => setGenInstruction(e.target.value)} />
                </div>
              </div>
            )}

            {/* Product upload */}
            {!genItemFile && (
              <div className="upload-grid upload-grid--single">
                <div className="upload-field" onClick={() => genItemRef.current?.click()} role="button" tabIndex={0}>
                  <span className="upload-field__icon">📦</span>
                  <div className="upload-field__label">Item / Product</div>
                  <div className="upload-field__hint">Upload the product image</div>
                  <input ref={genItemRef} className="upload-field__input" type="file"
                    accept="image/jpeg,image/png,image/webp" onChange={handleGenItemSelect} />
                </div>
              </div>
            )}

            {removingBg && (
              <div className="removing-bg-banner">
                <div className="removing-bg-banner__spinner" />
                <span>Removing background...</span>
              </div>
            )}

            {transparentUrl && !removingBg && selectedScene && (
              <ItemPreviewComposite
                backgroundUrl={selectedScene.backgroundUrl}
                itemPreviewUrl={transparentUrl}
                scale={itemScale}
                onScaleChange={setItemScale}
                shadowIntensity={shadowIntensity}
                onShadowIntensityChange={setShadowIntensity}
              />
            )}

            {genItemFile && (
              <div className="gen-section__actions">
                <button className="btn btn--primary" disabled={!selectedSceneId || generating || removingBg} onClick={handleGenerate}>
                  {generating ? "Generating..." : "Generate Image"}
                </button>
                <button className="btn btn--secondary" onClick={resetGenerator}>Reset</button>
              </div>
            )}

            {genResult && (
              <div className="gen-section__result">
                <div className="gen-section__result-img-wrap">
                  <img className="gen-section__result-img" src={genResult.imageUrl} alt="Generated" />
                </div>
                <div className="gen-section__result-actions">
                  <button className="btn btn--primary" onClick={handleUploadGenerated} disabled={uploadingGen}>
                    {uploadingGen ? "Uploading..." : "Send to Payload"}
                  </button>
                  <a className="btn btn--secondary" href={genResult.imageUrl} download={genResult.filename} target="_blank" rel="noreferrer">
                    Download
                  </a>
                  <button className="btn btn--secondary" onClick={resetGenerator}>New Image</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════ SERVICE PHOTO GENERATOR ════════ */}
      <div className="gen-section">
        <button className="gen-section__toggle" onClick={() => setShowService(!showService)}>
          <span className="gen-section__toggle-icon">{showService ? "▾" : "▸"}</span>
          Process Service Photo
        </button>

        {showService && (
          <div className="gen-section__body">
            {/* Logo upload */}
            <div className="service-logo-upload">
              <div
                className={`service-logo-upload__area ${svcLogoPreview ? "service-logo-upload__area--has-logo" : ""}`}
                onClick={() => svcLogoRef.current?.click()}
                role="button" tabIndex={0}
              >
                {svcLogoPreview ? (
                  <img className="service-logo-upload__preview" src={svcLogoPreview} alt="Logo" />
                ) : (
                  <>
                    <span className="upload-field__icon">🏷️</span>
                    <div className="upload-field__label">Upload Logo</div>
                  </>
                )}
              </div>
              {svcLogoPreview && (
                <button className="btn btn--ghost btn--sm" onClick={() => svcLogoRef.current?.click()}>Change Logo</button>
              )}
              <input ref={svcLogoRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={handleSvcLogoSelect} />
            </div>

            <FormatSelector value={svcFormat} onChange={setSvcFormat} />

            <div className="service-workspace">
              <div className="service-workspace__preview">
                {svcPhotoPreview ? (
                  <div className="service-preview__canvas">
                    <img className="service-preview__photo" src={svcPhotoPreview} alt="Photo preview" style={{ filter: svcCssFilter }} />
                    {svcLogoPreview && (
                      <img
                        className={`service-preview__logo service-preview__logo--${svcLogoPosition}`}
                        src={svcLogoPreview} alt="Logo"
                        style={{ maxWidth: `${svcLogoScale * 100}%` }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="service-preview__upload-area" onClick={() => svcPhotoRef.current?.click()} role="button" tabIndex={0}>
                    <span className="upload-field__icon">📷</span>
                    <div className="upload-field__label">Upload Photo</div>
                    <div className="upload-field__hint">Select a service photo</div>
                  </div>
                )}
                <input ref={svcPhotoRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={handleSvcPhotoSelect} />
              </div>

              <div className="service-workspace__controls">
                <LogoPositionGrid value={svcLogoPosition} onChange={setSvcLogoPosition} />

                <div className="input-group" style={{ marginTop: 16 }}>
                  <label className="input-group__label">Logo Size: <strong>{Math.round(svcLogoScale * 100)}%</strong></label>
                  <input className="composite-preview__slider" type="range"
                    min={0.05} max={0.50} step={0.01} value={svcLogoScale}
                    onChange={(e) => setSvcLogoScale(parseFloat(e.target.value))} />
                </div>

                <div className="service-lighting--inline">
                  <h4 className="service-lighting__title">Lighting</h4>
                  <LightingSlider label="Brightness" value={svcLighting.brightness} min={0.5} max={1.5} step={0.01} onChange={(v) => updateSvcLighting("brightness", v)} />
                  <LightingSlider label="Contrast" value={svcLighting.contrast} min={0.5} max={2.0} step={0.01} onChange={(v) => updateSvcLighting("contrast", v)} />
                  <LightingSlider label="Saturation" value={svcLighting.saturation} min={0.5} max={1.5} step={0.01} onChange={(v) => updateSvcLighting("saturation", v)} />
                  <LightingSlider label="Warmth" value={svcLighting.warmth} min={-1} max={1} step={0.05} onChange={(v) => updateSvcLighting("warmth", v)} />
                  <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => setSvcLighting({ ...LIGHTING_DEFAULTS })}>
                    Reset Lighting
                  </button>
                </div>

                {svcPhotoFile && (
                  <button className="btn btn--primary btn--full" style={{ marginTop: 20 }}
                    disabled={svcProcessing || !svcLogoFile} onClick={handleSvcProcess}>
                    {svcProcessing ? "Processing..." : "Process Photo"}
                  </button>
                )}
                {svcPhotoFile && !svcProcessing && (
                  <button className="btn btn--ghost btn--full" style={{ marginTop: 8 }} onClick={() => svcPhotoRef.current?.click()}>
                    Change Photo
                  </button>
                )}
                {!svcPhotoFile && (
                  <button className="btn btn--primary btn--full" style={{ marginTop: 20 }} onClick={() => svcPhotoRef.current?.click()}>
                    Upload Photo
                  </button>
                )}
              </div>
            </div>

            {svcResult && (
              <div className="gen-section__result">
                <div className="gen-section__result-img-wrap">
                  <img className="gen-section__result-img" src={svcResult.imageUrl} alt="Processed" />
                </div>
                <div className="gen-section__result-actions">
                  <button className="btn btn--primary" onClick={handleUploadSvc} disabled={uploadingSvc}>
                    {uploadingSvc ? "Uploading..." : "Send to Payload"}
                  </button>
                  <a className="btn btn--secondary" href={svcResult.imageUrl} download={svcResult.filename} target="_blank" rel="noreferrer">
                    Download
                  </a>
                  <button className="btn btn--secondary" onClick={resetService}>New Photo</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
