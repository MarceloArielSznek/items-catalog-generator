import { useState, useCallback, useRef, useEffect } from "react";
import { generateCatalogImage } from "../services/api.js";
import { validateImageFile, createPreviewUrl, revokePreviewUrl } from "../utils/fileHelpers.js";

const INITIAL_FILES = { background: null, item: null, logo: null };
const INITIAL_PREVIEWS = { background: null, item: null, logo: null };

export default function useCatalogComposer() {
  const [files, setFiles] = useState(INITIAL_FILES);
  const [previews, setPreviews] = useState(INITIAL_PREVIEWS);
  const [itemName, setItemName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [logoPosition, setLogoPosition] = useState("bottom-right");
  const [mode, setMode] = useState("quick");
  const [format, setFormat] = useState("square");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const previewUrlsRef = useRef({ ...INITIAL_PREVIEWS });

  const setFile = useCallback((field, file) => {
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);

    revokePreviewUrl(previewUrlsRef.current[field]);

    const previewUrl = createPreviewUrl(file);
    previewUrlsRef.current[field] = previewUrl;

    setFiles((prev) => ({ ...prev, [field]: file }));
    setPreviews((prev) => ({ ...prev, [field]: previewUrl }));
  }, []);

  const clearFile = useCallback((field) => {
    revokePreviewUrl(previewUrlsRef.current[field]);
    previewUrlsRef.current[field] = null;

    setFiles((prev) => ({ ...prev, [field]: null }));
    setPreviews((prev) => ({ ...prev, [field]: null }));
  }, []);

  const canGenerate = files.background && files.item && files.logo && !loading;

  const generate = useCallback(async () => {
    if (!canGenerate) return;

    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const response = await generateCatalogImage({
        background: files.background,
        item: files.item,
        logo: files.logo,
        itemName,
        instruction,
        logoPosition,
        mode,
        format,
      });
      setResult(response.data);
    } catch (err) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [canGenerate, files, itemName, instruction, logoPosition, mode, format]);

  const reset = useCallback(() => {
    Object.values(previewUrlsRef.current).forEach(revokePreviewUrl);
    previewUrlsRef.current = { ...INITIAL_PREVIEWS };

    setFiles(INITIAL_FILES);
    setPreviews(INITIAL_PREVIEWS);
    setItemName("");
    setInstruction("");
    setLogoPosition("bottom-right");
    setMode("quick");
    setFormat("square");
    setError(null);
    setResult(null);
  }, []);

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => Object.values(urls).forEach(revokePreviewUrl);
  }, []);

  return {
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
  };
}
