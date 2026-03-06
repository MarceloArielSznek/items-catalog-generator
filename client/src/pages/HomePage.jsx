import useCatalogComposer from "../hooks/useCatalogComposer.js";
import UploadField from "../components/UploadField.jsx";
import ModeSelector from "../components/ModeSelector.jsx";
import FormatSelector from "../components/FormatSelector.jsx";
import LogoPositionGrid from "../components/LogoPositionGrid.jsx";
import GenerateButton from "../components/GenerateButton.jsx";
import ResultPanel from "../components/ResultPanel.jsx";

const UPLOAD_FIELDS = ["background", "item", "logo"];

export default function HomePage() {
  const {
    files,
    previews,
    itemName,
    setItemName,
    instruction,
    setInstruction,
    logoPosition,
    setLogoPosition,
    mode,
    setMode,
    format,
    setFormat,
    loading,
    error,
    result,
    setFile,
    clearFile,
    canGenerate,
    generate,
    reset,
  } = useCatalogComposer();

  return (
    <main className="page">
      <h2 className="page__title">Create Catalog Image</h2>
      <p className="page__description">
        Upload a background, product item, and company logo to generate a professional catalog visual.
      </p>

      <div className="upload-grid">
        {UPLOAD_FIELDS.map((field) => (
          <UploadField
            key={field}
            field={field}
            file={files[field]}
            preview={previews[field]}
            onSelect={setFile}
            onClear={clearFile}
          />
        ))}
      </div>

      <ModeSelector value={mode} onChange={setMode} />
      <FormatSelector value={format} onChange={setFormat} />

      <div className="options-row">
        <div className="input-group">
          <label className="input-group__label" htmlFor="itemName">
            Item Name (optional)
          </label>
          <input
            id="itemName"
            className="input-group__input"
            type="text"
            placeholder="e.g. Fiberglass Batt Insulation"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label className="input-group__label" htmlFor="instruction">
            Extra Instructions (optional)
          </label>
          <input
            id="instruction"
            className="input-group__input"
            type="text"
            placeholder="e.g. Place item on the left side"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </div>
      </div>

      <div className="options-row options-row--logo">
        <LogoPositionGrid value={logoPosition} onChange={setLogoPosition} />
      </div>

      <GenerateButton
        canGenerate={canGenerate}
        loading={loading}
        onClick={generate}
      />

      {error && (
        <div className="error-banner">
          <span className="error-banner__icon">⚠</span>
          <span className="error-banner__message">{error}</span>
        </div>
      )}

      <ResultPanel result={result} onReset={reset} />
    </main>
  );
}
