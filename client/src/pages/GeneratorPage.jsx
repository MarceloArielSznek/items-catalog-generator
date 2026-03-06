import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSceneById, generateWithScene, downloadZip } from "../services/api.js";
import { validateImageFile, createPreviewUrl, revokePreviewUrl } from "../utils/fileHelpers.js";
import ModeSelector from "../components/ModeSelector.jsx";
import FormatSelector from "../components/FormatSelector.jsx";
import LogoPositionGrid from "../components/LogoPositionGrid.jsx";
import GenerateButton from "../components/GenerateButton.jsx";
import ResultPanel from "../components/ResultPanel.jsx";
import BulkUploadZone from "../components/BulkUploadZone.jsx";
import BulkResultsPanel from "../components/BulkResultsPanel.jsx";

export default function GeneratorPage() {
  const { sceneId } = useParams();
  const navigate = useNavigate();

  const [scene, setScene] = useState(null);
  const [sceneLoading, setSceneLoading] = useState(true);
  const [tab, setTab] = useState("single");

  const [mode, setMode] = useState("quick");
  const [format, setFormat] = useState("square");
  const [logoPosition, setLogoPosition] = useState(null);
  const [itemName, setItemName] = useState("");
  const [instruction, setInstruction] = useState("");

  const [itemFile, setItemFile] = useState(null);
  const [itemPreview, setItemPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [bulkItems, setBulkItems] = useState([]);
  const [bulkResults, setBulkResults] = useState([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const bulkAbortRef = useRef(false);

  const itemRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getSceneById(sceneId);
        setScene(res.data);
        setLogoPosition(res.data.logoPosition);
      } catch {
        navigate("/");
      } finally {
        setSceneLoading(false);
      }
    })();
  }, [sceneId, navigate]);

  const handleItemSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setError(err); return; }
    setError(null);
    if (itemPreview) revokePreviewUrl(itemPreview);
    setItemFile(file);
    setItemPreview(createPreviewUrl(file));
    setResult(null);
    e.target.value = "";
  }, [itemPreview]);

  const clearItem = useCallback(() => {
    if (itemPreview) revokePreviewUrl(itemPreview);
    setItemFile(null);
    setItemPreview(null);
  }, [itemPreview]);

  const handleGenerate = useCallback(async () => {
    if (!itemFile) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await generateWithScene({
        sceneId, item: itemFile, itemName, instruction, logoPosition, mode, format,
      });
      setResult(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sceneId, itemFile, itemName, instruction, logoPosition, mode, format]);

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
          sceneId, item: item.file, itemName: item.name || "", instruction, logoPosition, mode, format,
        });
        results.push({ ...res.data, originalName: item.file.name, status: "success" });
      } catch (err) {
        results.push({ originalName: item.file.name, status: "error", error: err.message });
      }
      setBulkResults([...results]);
    }
    setBulkRunning(false);
  }, [bulkItems, sceneId, instruction, logoPosition, mode, format]);

  const handleBulkAbort = useCallback(() => {
    bulkAbortRef.current = true;
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
    setItemName("");
    setInstruction("");
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

      <div className="scene-preview">
        <div className="scene-preview__images">
          <div className="scene-preview__bg">
            <img src={scene.backgroundUrl} alt="Background" />
          </div>
          <div className="scene-preview__logo">
            <img src={scene.logoUrl} alt="Logo" />
          </div>
        </div>
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

      <div className="options-row">
        {tab === "single" && (
          <div className="input-group">
            <label className="input-group__label" htmlFor="itemName">Item Name (optional)</label>
            <input id="itemName" className="input-group__input" type="text" placeholder="e.g. Fiberglass Batt Insulation" value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
        )}
        <div className="input-group">
          <label className="input-group__label" htmlFor="instruction">Extra Instructions (optional)</label>
          <input id="instruction" className="input-group__input" type="text" placeholder="e.g. Place item on the left side" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        </div>
      </div>

      <div className="options-row options-row--logo">
        <LogoPositionGrid value={logoPosition} onChange={setLogoPosition} />
      </div>

      {tab === "single" ? (
        <>
          <div className="upload-grid upload-grid--single">
            <div
              className={`upload-field ${itemFile ? "upload-field--has-file" : ""}`}
              onClick={() => itemRef.current?.click()}
              role="button" tabIndex={0}
            >
              {itemFile && <button className="upload-field__clear" onClick={(e) => { e.stopPropagation(); clearItem(); }} title="Remove">✕</button>}
              <span className="upload-field__icon">📦</span>
              <div className="upload-field__label">Item / Product</div>
              <div className="upload-field__hint">{itemFile ? itemFile.name : "Upload the product image"}</div>
              <input ref={itemRef} className="upload-field__input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleItemSelect} />
              {itemPreview && <div className="image-preview"><img className="image-preview__img" src={itemPreview} alt="Item preview" /></div>}
            </div>
          </div>

          <GenerateButton canGenerate={!!itemFile && !loading} loading={loading} onClick={handleGenerate} />

          {error && (
            <div className="error-banner">
              <span className="error-banner__icon">!</span>
              <span className="error-banner__message">{error}</span>
            </div>
          )}

          <ResultPanel result={result} onReset={resetSingle} />
        </>
      ) : (
        <>
          <BulkUploadZone items={bulkItems} onChange={setBulkItems} disabled={bulkRunning} />

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

          {error && (
            <div className="error-banner">
              <span className="error-banner__icon">!</span>
              <span className="error-banner__message">{error}</span>
            </div>
          )}

          <BulkResultsPanel
            results={bulkResults}
            progress={bulkProgress}
            running={bulkRunning}
            onDownloadAll={handleDownloadAll}
          />
        </>
      )}
    </main>
  );
}
