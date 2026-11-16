//! BLP2 texture decoder (mip level 0 only): DXT1/3/5, palettised (0/1/4/8-bit alpha) and raw BGRA.

use crate::error::{AppError, AppResult};

fn bad() -> AppError {
    AppError::new("wow_client", crate::i18n::tr("Ungültige BLP-Textur", "Invalid BLP texture"))
}

pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

const HEADER: usize = 20 + 64 + 64 + 1024;

pub fn decode(b: &[u8]) -> AppResult<Rgba> {
    if b.len() < HEADER || &b[0..4] != b"BLP2" {
        return Err(bad());
    }
    let u32at = |i: usize| u32::from_le_bytes(b[i..i + 4].try_into().unwrap());
    let (compression, alpha_depth, alpha_type) = (b[8], b[9], b[10]);
    let (w, h) = (u32at(12), u32at(16));
    if w == 0 || h == 0 || w > 4096 || h > 4096 {
        return Err(bad());
    }
    let (off, size) = (u32at(20) as usize, u32at(20 + 64) as usize);
    let data = b.get(off..off.checked_add(size).ok_or_else(bad)?).ok_or_else(bad)?;
    let (wu, hu) = (w as usize, h as usize);
    let mut px = vec![0u8; wu * hu * 4];
    match compression {
        2 => {
            let kind = match (alpha_depth, alpha_type) {
                (0 | 1, _) => 1,
                (_, 1) => 3,
                (_, 7) => 5,
                _ => 3,
            };
            let bsize = if kind == 1 { 8 } else { 16 };
            let (bw, bh) = (wu.div_ceil(4), hu.div_ceil(4));
            if data.len() < bw * bh * bsize {
                return Err(bad());
            }
            for by in 0..bh {
                for bx in 0..bw {
                    let blk = &data[(by * bw + bx) * bsize..][..bsize];
                    let mut out = [[0u8; 4]; 16];
                    let color = if kind == 1 { blk } else { &blk[8..] };
                    dxt_color(color, kind == 1, &mut out);
                    if kind == 3 {
                        for (i, o) in out.iter_mut().enumerate() {
                            let nib = (blk[i / 2] >> ((i % 2) * 4)) & 0xF;
                            o[3] = nib * 17;
                        }
                    } else if kind == 5 {
                        dxt5_alpha(&blk[..8], &mut out);
                    }
                    for (i, o) in out.iter().enumerate() {
                        let (x, y) = (bx * 4 + i % 4, by * 4 + i / 4);
                        if x < wu && y < hu {
                            px[(y * wu + x) * 4..][..4].copy_from_slice(o);
                        }
                    }
                }
            }
        }
        1 => {
            let n = wu * hu;
            let idx = data.get(..n).ok_or_else(bad)?;
            let alpha = &data[n..];
            for i in 0..n {
                let c = &b[148 + idx[i] as usize * 4..][..4]; // palette is BGRA
                let a = match alpha_depth {
                    0 => 255,
                    1 => if alpha.get(i / 8).map_or(0, |v| (v >> (i % 8)) & 1) == 1 { 255 } else { 0 },
                    4 => alpha.get(i / 2).map_or(0, |v| (v >> ((i % 2) * 4)) & 0xF) * 17,
                    _ => *alpha.get(i).unwrap_or(&255),
                };
                px[i * 4..][..4].copy_from_slice(&[c[2], c[1], c[0], a]);
            }
        }
        3 => {
            let raw = data.get(..wu * hu * 4).ok_or_else(bad)?;
            for (i, c) in raw.chunks_exact(4).enumerate() {
                px[i * 4..][..4].copy_from_slice(&[c[2], c[1], c[0], c[3]]);
            }
        }
        _ => return Err(bad()),
    }
    Ok(Rgba { width: w, height: h, pixels: px })
}

fn rgb565(v: u16) -> [u8; 3] {
    let r = ((v >> 11) & 0x1F) as u32;
    let g = ((v >> 5) & 0x3F) as u32;
    let b = (v & 0x1F) as u32;
    [((r * 255 + 15) / 31) as u8, ((g * 255 + 31) / 63) as u8, ((b * 255 + 15) / 31) as u8]
}

fn dxt_color(blk: &[u8], dxt1: bool, out: &mut [[u8; 4]; 16]) {
    let c0 = u16::from_le_bytes([blk[0], blk[1]]);
    let c1 = u16::from_le_bytes([blk[2], blk[3]]);
    let (a, b) = (rgb565(c0), rgb565(c1));
    let mix = |wa: u32, wb: u32, d: u32| -> [u8; 4] {
        let f = |i: usize| ((a[i] as u32 * wa + b[i] as u32 * wb) / d) as u8;
        [f(0), f(1), f(2), 255]
    };
    let pal: [[u8; 4]; 4] = if c0 > c1 || !dxt1 {
        [mix(1, 0, 1), mix(0, 1, 1), mix(2, 1, 3), mix(1, 2, 3)]
    } else {
        [mix(1, 0, 1), mix(0, 1, 1), mix(1, 1, 2), [0, 0, 0, 0]]
    };
    let bits = u32::from_le_bytes([blk[4], blk[5], blk[6], blk[7]]);
    for (i, o) in out.iter_mut().enumerate() {
        *o = pal[((bits >> (i * 2)) & 3) as usize];
    }
}

fn dxt5_alpha(blk: &[u8], out: &mut [[u8; 4]; 16]) {
    let (a0, a1) = (blk[0] as u32, blk[1] as u32);
    let mut t = [0u32; 8];
    t[0] = a0;
    t[1] = a1;
    if a0 > a1 {
        for i in 1..7 {
            t[i + 1] = ((7 - i as u32) * a0 + i as u32 * a1) / 7;
        }
    } else {
        for i in 1..5 {
            t[i + 1] = ((5 - i as u32) * a0 + i as u32 * a1) / 5;
        }
        t[6] = 0;
        t[7] = 255;
    }
    let bits = blk[2..8].iter().rev().fold(0u64, |acc, v| (acc << 8) | *v as u64);
    for (i, o) in out.iter_mut().enumerate() {
        o[3] = t[((bits >> (i * 3)) & 7) as usize] as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blp(compression: u8, alpha_depth: u8, w: u32, h: u32, data: &[u8], palette: &[[u8; 4]]) -> Vec<u8> {
        let mut b = vec![0u8; HEADER];
        b[0..4].copy_from_slice(b"BLP2");
        b[4] = 1;
        b[8] = compression;
        b[9] = alpha_depth;
        b[12..16].copy_from_slice(&w.to_le_bytes());
        b[16..20].copy_from_slice(&h.to_le_bytes());
        b[20..24].copy_from_slice(&(HEADER as u32).to_le_bytes());
        b[84..88].copy_from_slice(&(data.len() as u32).to_le_bytes());
        for (i, c) in palette.iter().enumerate() {
            b[148 + i * 4..152 + i * 4].copy_from_slice(c);
        }
        b.extend_from_slice(data);
        b
    }

    #[test]
    fn decodes_dxt1_solid_block() {
        // c0 = pure red (0xF800), c1 = black, all indices 0 -> red
        let d = [0x00, 0xF8, 0x00, 0x00, 0, 0, 0, 0];
        let img = decode(&blp(2, 0, 4, 4, &d, &[])).unwrap();
        assert_eq!((img.width, img.height), (4, 4));
        assert!(img.pixels.chunks(4).all(|p| p == [255, 0, 0, 255]));
        // index 3 = 1/3 red + 2/3 black
        let d = [0x00, 0xF8, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF];
        assert_eq!(&decode(&blp(2, 0, 4, 4, &d, &[])).unwrap().pixels[0..4], &[85, 0, 0, 255]);
    }

    #[test]
    fn decodes_palette_and_rejects_garbage() {
        let img = decode(&blp(1, 0, 2, 1, &[0, 1], &[[10, 20, 30, 0], [1, 2, 3, 0]])).unwrap();
        assert_eq!(img.pixels, vec![30, 20, 10, 255, 3, 2, 1, 255]);
        assert!(decode(b"BLP1").is_err());
        assert!(decode(&blp(2, 0, 8, 8, &[0; 8], &[])).is_err(), "too little DXT data");
    }
}
