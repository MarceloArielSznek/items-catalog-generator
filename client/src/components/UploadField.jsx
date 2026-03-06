import { useRef } from "react";
import ImagePreviewCard from "./ImagePreviewCard.jsx";

const FIELD_CONFIG = {
  background: { label: "Background", icon: "🖼️", hint: "Attic or crawl space scene" },
  item:       { label: "Item / Product", icon: "📦", hint: "Insulation, fan, bucket, etc." },
  logo:       { label: "Company Logo", icon: "🏷️", hint: "Your brand logo" },
};

export default function UploadField({ field, file, preview, onSelect, onClear }) {
  const inputRef = useRef(null);
  const config = FIELD_CONFIG[field] || { label: field, icon: "📁", hint: "" };
  const hasFile = !!file;

  function handleClick() {
    inputRef.current?.click();
  }

  function handleChange(e) {
    const selected = e.target.files?.[0];
    if (selected) onSelect(field, selected);
    e.target.value = "";
  }

  function handleClear(e) {
    e.stopPropagation();
    onClear(field);
  }

  return (
    <div
      className={`upload-field ${hasFile ? "upload-field--has-file" : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
    >
      {hasFile && (
        <button className="upload-field__clear" onClick={handleClear} title="Remove">
          ✕
        </button>
      )}

      <span className="upload-field__icon">{config.icon}</span>
      <div className="upload-field__label">{config.label}</div>
      <div className="upload-field__hint">
        {hasFile ? file.name : config.hint}
      </div>

      <input
        ref={inputRef}
        className="upload-field__input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
      />

      {hasFile && preview && (
        <ImagePreviewCard src={preview} name={file.name} />
      )}
    </div>
  );
}
