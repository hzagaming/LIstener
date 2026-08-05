export function artworkFilename(title: string, contentType: string): string
export function builtInArtwork(theme: string, title: string, artist: string): { svg: string; type: 'image/svg+xml' }
export function readArtworkResponse(response: Response, maximum?: number): Promise<Blob>
