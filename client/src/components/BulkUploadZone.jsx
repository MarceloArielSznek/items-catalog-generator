import { useRef, useCallback } from "react";
import { validateImageFile, createPreviewUrl, revokePreviewUrl } from "../utils/fileHelpers.js";

export default function BulkUploadZone({ items, onChange, disabled }) {
  const inputRef = useRef(null);

  const addFiles = useCallback((fileList) => {
    const newItems = [];
    for (const file of fileList) {
      const err = validateImageFile(file);
      if (err) continue;
      newItems.push({ id: `${Date.now()}-${Math.random()}`, file, preview: createPreviewUrl(file), name: "" });
    }
    if (newItems.length > 0) onChange((prev) => [...prev, ...newItems]);
  }, [onChange]);

  function handleDrop(e) {
    e.preventDefault();
    if (disabled) return;
    addFiles(e.dataTransfer.files);
  }

  function handleChange(e) {
    addFiles(e.target.files);
    e.target.value = "";
  }

  function removeItem(id) {
    onChange((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item?.preview) revokePreviewUrl(item.preview);
      return prev.filter((i) => i.id !== id);
    });
  }

  function updateName(id, name) {
    onChange((prev) => prev.map((i) => (i.id === id ? { ...i, name } : i)));
  }

  return (
    <div className="bulk-zone">
      <div
        className={`bulk-zone__drop ${disabled ? "bulk-zone__drop--disabled" : ""}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
      >
        <span className="bulk-zone__icon">📦</span>
        <p className="bulk-zone__text">Drop item images here or click to browse</p>
        <p className="bulk-zone__hint">JPG, PNG, WebP — multiple files supported</p>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleChange} style={{ display: "none" }} />
      </div>

      {items.length > 0 && (
        <div className="bulk-zone__list">
          {items.map((item) => (
            <div key={item.id} className="bulk-item">
              <img className="bulk-item__img" src={item.preview} alt={item.file.name} />
              <div className="bulk-item__info">
                <span className="bulk-item__filename">{item.file.name}</span>
                <input
                  className="bulk-item__name"
                  type="text"
                  placeholder="Item name (optional)"
                  value={item.name}
                  onChange={(e) => updateName(item.id, e.target.value)}
                  disabled={disabled}
                />
              </div>
              {!disabled && (
                <button className="bulk-item__remove" onClick={() => removeItem(item.id)} title="Remove">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
