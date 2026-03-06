import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { listScenes, createScene, deleteScene, updateScene } from "../services/api.js";
import LogoPositionGrid from "../components/LogoPositionGrid.jsx";
import { validateImageFile, createPreviewUrl, revokePreviewUrl } from "../utils/fileHelpers.js";

export default function SceneManagerPage() {
  const navigate = useNavigate();
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [bgFile, setBgFile] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [bgPreview, setBgPreview] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoPosition, setLogoPosition] = useState("bottom-right");

  const bgRef = useRef(null);
  const logoRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await listScenes();
      setScenes(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleFile(setter, previewSetter, oldPreview) {
    return (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const err = validateImageFile(file);
      if (err) { setError(err); return; }
      setError(null);
      if (oldPreview) revokePreviewUrl(oldPreview);
      setter(file);
      previewSetter(createPreviewUrl(file));
      e.target.value = "";
    };
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!bgFile || !logoFile) { setError("Background and logo are required"); return; }
    setCreating(true);
    setError(null);
    try {
      await createScene({ name: name || "Untitled Scene", background: bgFile, logo: logoFile, logoPosition });
      resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function resetForm() {
    setShowForm(false);
    setName("");
    setBgFile(null);
    setLogoFile(null);
    if (bgPreview) revokePreviewUrl(bgPreview);
    if (logoPreview) revokePreviewUrl(logoPreview);
    setBgPreview(null);
    setLogoPreview(null);
    setLogoPosition("bottom-right");
  }

  const [editingScene, setEditingScene] = useState(null);
  const [editName, setEditName] = useState("");
  const [editLogoPosition, setEditLogoPosition] = useState("bottom-right");
  const [editBgFile, setEditBgFile] = useState(null);
  const [editLogoFile, setEditLogoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const editBgRef = useRef(null);
  const editLogoRef = useRef(null);

  function startEdit(scene) {
    setEditingScene(scene.id);
    setEditName(scene.name);
    setEditLogoPosition(scene.logoPosition || "bottom-right");
    setEditBgFile(null);
    setEditLogoFile(null);
  }

  function cancelEdit() {
    setEditingScene(null);
    setEditBgFile(null);
    setEditLogoFile(null);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateScene(editingScene, {
        name: editName,
        logoPosition: editLogoPosition,
        background: editBgFile,
        logo: editLogoFile,
      });
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this scene?")) return;
    try {
      await deleteScene(id);
      setScenes((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h2 className="page__title">Scenes</h2>
          <p className="page__description">
            Create a scene with a background and logo, then generate catalog images by just uploading items.
          </p>
        </div>
        {!showForm && (
          <button className="btn btn--primary" onClick={() => setShowForm(true)}>
            + New Scene
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-banner__icon">!</span>
          <span className="error-banner__message">{error}</span>
        </div>
      )}

      {showForm && (
        <form className="scene-form" onSubmit={handleCreate}>
          <h3 className="scene-form__title">Create Scene</h3>

          <div className="scene-form__row">
            <div className="input-group">
              <label className="input-group__label">Scene Name</label>
              <input
                className="input-group__input"
                type="text"
                placeholder="e.g. Attic Showroom"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="scene-form__uploads">
            <div
              className={`upload-field ${bgFile ? "upload-field--has-file" : ""}`}
              onClick={() => bgRef.current?.click()}
              role="button" tabIndex={0}
            >
              <span className="upload-field__icon">🖼️</span>
              <div className="upload-field__label">Background</div>
              <div className="upload-field__hint">{bgFile ? bgFile.name : "Attic or crawl space scene"}</div>
              <input ref={bgRef} className="upload-field__input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile(setBgFile, setBgPreview, bgPreview)} />
              {bgPreview && <div className="image-preview"><img className="image-preview__img" src={bgPreview} alt="Background preview" /></div>}
            </div>

            <div
              className={`upload-field ${logoFile ? "upload-field--has-file" : ""}`}
              onClick={() => logoRef.current?.click()}
              role="button" tabIndex={0}
            >
              <span className="upload-field__icon">🏷️</span>
              <div className="upload-field__label">Logo</div>
              <div className="upload-field__hint">{logoFile ? logoFile.name : "Your brand logo"}</div>
              <input ref={logoRef} className="upload-field__input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile(setLogoFile, setLogoPreview, logoPreview)} />
              {logoPreview && <div className="image-preview"><img className="image-preview__img" src={logoPreview} alt="Logo preview" /></div>}
            </div>
          </div>

          <div className="scene-form__row">
            <LogoPositionGrid value={logoPosition} onChange={setLogoPosition} />
          </div>

          <div className="scene-form__actions">
            <button type="submit" className="btn btn--primary" disabled={creating || !bgFile || !logoFile}>
              {creating ? "Creating..." : "Create Scene"}
            </button>
            <button type="button" className="btn btn--secondary" onClick={resetForm}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="scenes-empty">Loading scenes...</p>
      ) : scenes.length === 0 && !showForm ? (
        <div className="scenes-empty">
          <p>No scenes yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="scenes-grid">
          {scenes.map((scene) => (
            <div key={scene.id} className="scene-card">
              {editingScene === scene.id ? (
                <form className="scene-card__edit" onSubmit={handleSaveEdit}>
                  <div className="input-group" style={{ marginBottom: 12 }}>
                    <input className="input-group__input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Scene name" />
                  </div>
                  <div className="scene-card__edit-uploads">
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => editBgRef.current?.click()}>
                      {editBgFile ? "Background ✓" : "Change Background"}
                    </button>
                    <input ref={editBgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setEditBgFile(e.target.files?.[0] || null)} />
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => editLogoRef.current?.click()}>
                      {editLogoFile ? "Logo ✓" : "Change Logo"}
                    </button>
                    <input ref={editLogoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setEditLogoFile(e.target.files?.[0] || null)} />
                  </div>
                  <div style={{ margin: "12px 0" }}>
                    <LogoPositionGrid value={editLogoPosition} onChange={setEditLogoPosition} />
                  </div>
                  <div className="scene-card__actions">
                    <button type="submit" className="btn btn--primary btn--sm" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="scene-card__bg">
                    <img src={`/scenes/${scene.id}/${scene.backgroundFile}`} alt={scene.name} />
                    <img className="scene-card__logo" src={`/scenes/${scene.id}/${scene.logoFile}`} alt="Logo" />
                  </div>
                  <div className="scene-card__body">
                    <span className="scene-card__name">{scene.name}</span>
                    <span className="scene-card__date">{new Date(scene.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="scene-card__actions">
                    <button className="btn btn--primary btn--sm" onClick={() => navigate(`/generate/${scene.id}`)}>
                      Use Scene
                    </button>
                    <button className="btn btn--secondary btn--sm" onClick={() => startEdit(scene)}>
                      Edit
                    </button>
                    <button className="btn btn--danger btn--sm" onClick={() => handleDelete(scene.id)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
