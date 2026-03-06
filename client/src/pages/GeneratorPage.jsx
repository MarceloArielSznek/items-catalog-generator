import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSceneById, generateWithScene, downloadZip, removeBackground } from "../services/api.js";
import SaveItemModal from "../components/SaveItemModal.jsx";
import BulkSaveModal from "../components/BulkSaveModal.jsx";
import { validateImageFile, createPreviewUrl, revokePreviewUrl } from "../utils/fileHelpers.js";
import ModeSelector from "../components/ModeSelector.jsx";
import FormatSelector from "../components/FormatSelector.jsx";
import GenerateButton from "../components/GenerateButton.jsx";
import BulkCarousel from "../components/BulkCarousel.jsx";
import BulkResultsPanel from "../components/BulkResultsPanel.jsx";
import ItemPreviewComposite from "../components/ItemPreviewComposite.jsx";
import { COMPOSITION_DEFAULTS } from "../../../shared/constants/imageRules.js";

export default function GeneratorPage() {
  const { sceneId } = useParams();
  const navigate = useNavigate();

  const [scene, setScene] = useState(null);
  const [sceneLoading, setSceneLoading] = useState(true);
  const [tab, setTab] = useState("single");

  const [mode, setMode] = useState("quick");
  const [format, setFormat] = useState("square");
  const [instruction, setInstruction] = useState("");

  const [itemFile, setItemFile] = useState(null);
  const [itemPreview, setItemPreview] = useState(null);
  const [transparentUrl, setTransparentUrl] = useState(null);
  const [removingBg, setRemovingBg] = useState(false);
  const [itemScale, setItemScale] = useState(COMPOSITION_DEFAULTS.itemScale);
  const [shadowIntensity, setShadowIntensity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);

  const [bulkItems, setBulkItems] = useState([]);
  const [bulkActiveIndex, setBulkActiveIndex] = useState(0);
  const [bulkResults, setBulkResults] = useState([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [showBulkSaveModal, setShowBulkSaveModal] = useState(false);
  const bulkAbortRef = useRef(false);

  const itemRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getSceneById(sceneId);
        setScene(res.data);
      } catch {
        navigate("/");
      } finally {
        setSceneLoading(false);
      }
    })();
  }, [sceneId, navigate]);

  const handleItemSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setError(err); return; }
    setError(null);
    if (itemPreview) revokePreviewUrl(itemPreview);
    setItemFile(file);
    setItemPreview(createPreviewUrl(file));
    setTransparentUrl(null);
    setResult(null);
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
  }, [itemPreview]);

  const clearItem = useCallback(() => {
    if (itemPreview) revokePreviewUrl(itemPreview);
    setItemFile(null);
    setItemPreview(null);
    setTransparentUrl(null);
  }, [itemPreview]);

  const handleGenerate = useCallback(async () => {
    if (!itemFile) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await generateWithScene({
        sceneId, item: itemFile, itemName: "", instruction, logoPosition: scene.logoPosition, mode, format, itemScale, shadowIntensity,
      });
      setResult(res.data);
      setShowSaveModal(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sceneId, scene, itemFile, instruction, mode, format, itemScale, shadowIntensity]);

  const handleBulkGenerate = useCallback(async () => {
    if (bulkItems.length === 0) return;
    setBulkRunning(true);
    setBulkResults([]);
    setBulkProgress({ current: 0, total: bulkItems.length });
    bulkAbortRef.current = false;

    const results = [];
    for (let i = 0; i < bulkItems.length; i++) {
      if (bulkAbortRef.current) break;
      setBulkProgress({ current: i + 1, total: bulkItems.length });
      const item = bulkItems[i];
      try {
        const res = await generateWithScene({
          sceneId, item: item.file, itemName: item.name || "", instruction,
          logoPosition: scene.logoPosition, mode, format,
          itemScale: item.itemScale, shadowIntensity: item.shadowIntensity,
        });
        results.push({ ...res.data, originalName: item.file.name, status: "success",
          itemScale: item.itemScale, shadowIntensity: item.shadowIntensity });
      } catch (err) {
        results.push({ originalName: item.file.name, status: "error", error: err.message });
      }
      setBulkResults([...results]);
    }
    setBulkRunning(false);
    if (results.some((r) => r.status === "success")) {
      setShowBulkSaveModal(true);
    }
  }, [bulkItems, sceneId, scene, instruction, mode, format]);

  const handleBulkAbort = useCallback(() => {
    bulkAbortRef.current = true;
  }, []);

  const resetBulk = useCallback(() => {
    setBulkItems([]);
    setBulkActiveIndex(0);
    setBulkResults([]);
    setShowBulkSaveModal(false);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    const filenames = bulkResults.filter((r) => r.status === "success" && r.filename).map((r) => r.filename);
    if (filenames.length === 0) return;
    try {
      const blob = await downloadZip(filenames);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "catalog-images.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }, [bulkResults]);

  const resetSingle = useCallback(() => {
    clearItem();
    setResult(null);
    setError(null);
    setInstruction("");
    setItemScale(COMPOSITION_DEFAULTS.itemScale);
    setShadowIntensity(1);
  }, [clearItem]);

  if (sceneLoading) return <main className="page"><p>Loading scene...</p></main>;
  if (!scene) return null;

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <button className="btn btn--link" onClick={() => navigate("/")}>← Back to Scenes</button>
          <h2 className="page__title">{scene.name}</h2>
        </div>
      </div>

      <div className="scene-preview scene-preview--banner">
        <img className="scene-preview__bg-img" src={scene.backgroundUrl} alt="Background" />
        <img
          className={`scene-preview__logo-overlay scene-preview__logo--${scene.logoPosition || "bottom-right"}`}
          src={scene.logoUrl}
          alt="Logo"
        />
      </div>

      <div className="tabs">
        <button className={`tabs__btn ${tab === "single" ? "tabs__btn--active" : ""}`} onClick={() => setTab("single")}>
          Single Item
        </button>
        <button className={`tabs__btn ${tab === "bulk" ? "tabs__btn--active" : ""}`} onClick={() => setTab("bulk")}>
          Bulk Generate
        </button>
      </div>

      <ModeSelector value={mode} onChange={setMode} />
      <FormatSelector value={format} onChange={setFormat} />

      {mode !== "quick" && (
        <div className="options-row">
          <div className="input-group">
            <label className="input-group__label" htmlFor="instruction">Extra Instructions (optional)</label>
            <input id="instruction" className="input-group__input" type="text" placeholder="e.g. Place item on the left side" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          </div>
        </div>
      )}

      {tab === "single" ? (
        <>
          {!itemFile && (
            <div className="upload-grid upload-grid--single">
              <div
                className="upload-field"
                onClick={() => itemRef.current?.click()}
                role="button" tabIndex={0}
              >
                <span className="upload-field__icon">📦</span>
                <div className="upload-field__label">Item / Product</div>
                <div className="upload-field__hint">Upload the product image</div>
                <input ref={itemRef} className="upload-field__input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleItemSelect} />
              </div>
            </div>
          )}

          {removingBg && (
            <div className="removing-bg-banner">
              <div className="removing-bg-banner__spinner" />
              <span>Removing background…</span>
            </div>
          )}

          {transparentUrl && !removingBg && (
            <ItemPreviewComposite
              backgroundUrl={scene.backgroundUrl}
              itemPreviewUrl={transparentUrl}
              scale={itemScale}
              onScaleChange={setItemScale}
              shadowIntensity={shadowIntensity}
              onShadowIntensityChange={setShadowIntensity}
            />
          )}

          {itemFile && (
            <GenerateButton canGenerate={!loading && !removingBg} loading={loading} onClick={handleGenerate} />
          )}

          {error && (
            <div className="error-banner">
              <span className="error-banner__icon">!</span>
              <span className="error-banner__message">{error}</span>
            </div>
          )}

          {result && !showSaveModal && (
            <div className="result-inline">
              <span className="result-inline__text">Image generated successfully</span>
              <a className="btn btn--ghost btn--sm" href={result.imageUrl} download={result.filename} target="_blank" rel="noreferrer">Download</a>
              <button className="btn btn--ghost btn--sm" onClick={() => setShowSaveModal(true)}>Save to Library</button>
              <button className="btn btn--ghost btn--sm" onClick={resetSingle}>New Image</button>
            </div>
          )}

          {showSaveModal && result && (
            <SaveItemModal
              result={result}
              sceneId={sceneId}
              sceneName={scene.name}
              itemName=""
              itemScale={itemScale}
              shadowIntensity={shadowIntensity}
              mode={mode}
              format={format}
              onSaved={resetSingle}
              onSkip={() => setShowSaveModal(false)}
            />
          )}
        </>
      ) : (
        <>
          <BulkCarousel
            items={bulkItems}
            onChange={setBulkItems}
            activeIndex={bulkActiveIndex}
            onActiveIndexChange={setBulkActiveIndex}
            backgroundUrl={scene.backgroundUrl}
            disabled={bulkRunning}
          />

          <div className="bulk-actions">
            {!bulkRunning ? (
              <button className="btn btn--primary btn--full" disabled={bulkItems.length === 0} onClick={handleBulkGenerate}>
                Generate {bulkItems.length} Image{bulkItems.length !== 1 ? "s" : ""}
              </button>
            ) : (
              <button className="btn btn--danger btn--full" onClick={handleBulkAbort}>
                Stop ({bulkProgress.current}/{bulkProgress.total})
              </button>
            )}
          </div>

          {bulkRunning && (
            <BulkResultsPanel
              results={bulkResults}
              progress={bulkProgress}
              running={bulkRunning}
              onDownloadAll={handleDownloadAll}
            />
          )}

          {error && (
            <div className="error-banner">
              <span className="error-banner__icon">!</span>
              <span className="error-banner__message">{error}</span>
            </div>
          )}

          {showBulkSaveModal && bulkResults.length > 0 && (
            <BulkSaveModal
              results={bulkResults}
              sceneId={sceneId}
              sceneName={scene.name}
              mode={mode}
              format={format}
              onAllSaved={resetBulk}
              onSkip={() => setShowBulkSaveModal(false)}
            />
          )}
        </>
      )}
    </main>
  );
}
