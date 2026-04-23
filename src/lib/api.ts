// Helper para llamadas a la API local del VPS (Node.js)
// En producción con túnel HTTPS, siempre usar URLs relativas para evitar mixed-content
const getApiBase = () => {
  const envBase = import.meta.env.VITE_LOCAL_API_URL || '';

  if (typeof window === 'undefined') {
    return envBase;
  }

  // En dominio/túnel/VPS publicado conviene usar relativa para que Nginx resuelva /api.
  const isPublishedPanel = window.location.port !== '8080';
  if (isPublishedPanel) {
    return '';
  }

  // Si estamos en HTTPS y la API apunta a HTTP, usar relativa para evitar mixed-content.
  if (window.location.protocol === 'https:' && envBase.startsWith('http://')) {
    return '';
  }

  return envBase;
};
const API_BASE = getApiBase();

export const getAdminToken = () => localStorage.getItem('admin_token');
export const setAdminToken = (token: string) => localStorage.setItem('admin_token', token);
export const clearAdminToken = () => localStorage.removeItem('admin_token');

export const api = async (path: string, options: RequestInit = {}) => {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (fetchErr: any) {
    // Network error - give more context for debugging
    throw new Error(`No se pudo conectar al servidor (${path}). Verifica que el servicio Node.js esté activo. Detalle: ${fetchErr.message}`);
  }

  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Respuesta inesperada del servidor (${response.status}): ${text.substring(0, 200)}`);
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status}`);
  }

  return data;
};

export const apiGet = <T = any>(path: string): Promise<T> => api(path, { method: 'GET' });
export const apiPost = <T = any>(path: string, body: any): Promise<T> => api(path, { method: 'POST', body: JSON.stringify(body) });
export const apiPut = <T = any>(path: string, body: any): Promise<T> => api(path, { method: 'PUT', body: JSON.stringify(body) });
export const apiDelete = <T = any>(path: string): Promise<T> => api(path, { method: 'DELETE' });
