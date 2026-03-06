import { useRef, useCallback } from "react";
import { validateImageFile, createPreviewUrl, revokePreviewUrl } from "../utils/fileHelpers.js";
import { removeBackground } from "../services/api.js";
import { COMPOSITION_DEFAULTS } from "../../../shared/constants/imageRules.js";
import ItemPreviewComposite from "./ItemPreviewComposite.jsx";

export default function BulkCarousel({ items, onChange, activeIndex, onActiveIndexChange, backgroundUrl, disabled }) {
  const inputRef = useRef(null);

  const addFiles = useCallback(async (fileList) => {
    const newItems = [];
    for (const file of fileList) {
      const err = validateImageFile(file);
      if (err) continue;
      newItems.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        preview: createPreviewUrl(file),
        name: "",
        transparentUrl: null,
        removingBg: true,
        itemScale: COMPOSITION_DEFAULTS.itemScale,
        shadowIntensity: 1,
      });
    }
    if (newItems.length === 0) return;

    onChange((prev) => {
      const updated = [...prev, ...newItems];
      if (prev.length === 0) onActiveIndexChange(0);
      return updated;
    });

    for (const item of newItems) {
      try {
        const res = await removeBackground(item.file);
        onChange((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, transparentUrl: res.data.imageUrl, removingBg: false } : i
          )
        );
      } catch {
        onChange((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, removingBg: false } : i
          )
        );
      }
    }
  }, [onChange, onActiveIndexChange]);

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
      const next = prev.filter((i) => i.id !== id);
      if (activeIndex >= next.length && next.length > 0) {
        onActiveIndexChange(next.length - 1);
      }
      return next;
    });
  }

  function updateName(id, name) {
    onChange((prev) => prev.map((i) => (i.id === id ? { ...i, name } : i)));
  }

  function updateScale(id, scale) {
    onChange((prev) => prev.map((i) => (i.id === id ? { ...i, itemScale: scale } : i)));
  }

  function updateShadow(id, shadow) {
    onChange((prev) => prev.map((i) => (i.id === id ? { ...i, shadowIntensity: shadow } : i)));
  }

  function goPrev() {
    onActiveIndexChange(Math.max(0, activeIndex - 1));
  }
  function goNext() {
    onActiveIndexChange(Math.min(items.length - 1, activeIndex + 1));
  }

  const activeItem = items[activeIndex];

  return (
    <div className="bulk-carousel">
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

      {items.length > 0 && activeItem && (
        <div className="bulk-carousel__viewer">
          <div className="bulk-carousel__nav">
            <button
              className="bulk-carousel__arrow"
              onClick={goPrev}
              disabled={activeIndex === 0}
              aria-label="Previous"
            >
              ‹
            </button>
            <span className="bulk-carousel__counter">
              {activeIndex + 1} / {items.length}
            </span>
            <button
              className="bulk-carousel__arrow"
              onClick={goNext}
              disabled={activeIndex === items.length - 1}
              aria-label="Next"
            >
              ›
            </button>
          </div>

          {activeItem.removingBg && (
            <div className="removing-bg-banner">
              <div className="removing-bg-banner__spinner" />
              <span>Removing background…</span>
            </div>
          )}

          {activeItem.transparentUrl && !activeItem.removingBg && (
            <ItemPreviewComposite
              backgroundUrl={backgroundUrl}
              itemPreviewUrl={activeItem.transparentUrl}
              scale={activeItem.itemScale}
              onScaleChange={(v) => updateScale(activeItem.id, v)}
              shadowIntensity={activeItem.shadowIntensity}
              onShadowIntensityChange={(v) => updateShadow(activeItem.id, v)}
            />
          )}

          <div className="bulk-carousel__item-info">
            <span className="bulk-carousel__filename">{activeItem.file.name}</span>
            <input
              className="bulk-carousel__name-input"
              type="text"
              placeholder="Item name (optional)"
              value={activeItem.name}
              onChange={(e) => updateName(activeItem.id, e.target.value)}
              disabled={disabled}
            />
            {!disabled && (
              <button className="bulk-carousel__remove" onClick={() => removeItem(activeItem.id)} title="Remove this item">
                ✕
              </button>
            )}
          </div>

          <div className="bulk-carousel__dots">
            {items.map((item, idx) => (
              <button
                key={item.id}
                className={`bulk-carousel__dot ${idx === activeIndex ? "bulk-carousel__dot--active" : ""}`}
                onClick={() => onActiveIndexChange(idx)}
                aria-label={`Go to item ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
