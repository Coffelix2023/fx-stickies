//! 窗口几何：判断保存的 frame 是否落在当前可见屏幕内，并在必要时给出可见 frame。
//!
//! 这里只有纯函数，不依赖 Tauri 类型，便于用假显示器数据直接测试。

use serde::{Deserialize, Serialize};

/// 屏幕坐标下的矩形。窗口位置和显示器可见区域都用它表示。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn bottom(&self) -> f64 {
        self.y + self.height
    }
}

/// 尺寸，用于折叠前保存的展开尺寸。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

/// 把 frame 的宽高抬到下限，位置不动。手动缩小的下限由窗口层设置，
/// 这里兜住存档里已经小于下限的旧尺寸，否则那样的便签会一直卡在不可用的大小。
pub fn at_least(frame: Rect, width: f64, height: f64) -> Rect {
    Rect {
        width: frame.width.max(width),
        height: frame.height.max(height),
        ..frame
    }
}

/// 与任一显示器有重叠即视为可见。
pub fn is_visible(frame: &Rect, monitors: &[Rect]) -> bool {
    monitors.iter().any(|m| {
        let overlap_x = frame.right().min(m.right()) - frame.x.max(m.x);
        let overlap_y = frame.bottom().min(m.bottom()) - frame.y.max(m.y);
        overlap_x > 0.0 && overlap_y > 0.0
    })
}

/// 返回窗口应当使用的 frame。可见时原样返回；不可见时移进第一个显示器的可见区域。
/// 没有任何显示器时无从判断，原样返回。
pub fn fit(frame: Rect, monitors: &[Rect]) -> Rect {
    let Some(monitor) = monitors.first() else {
        return frame;
    };
    if is_visible(&frame, monitors) {
        return frame;
    }
    Rect {
        // 窗口比显示器还大时 clamp 的上下界会颠倒，此时落在显示器原点。
        x: frame.x.min(monitor.right() - frame.width).max(monitor.x),
        y: frame.y.min(monitor.bottom() - frame.height).max(monitor.y),
        ..frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect::new(x, y, width, height)
    }

    #[test]
    fn frame_inside_monitor_is_visible() {
        let monitors = [monitor(0.0, 0.0, 1920.0, 1080.0)];
        let frame = Rect::new(100.0, 100.0, 300.0, 200.0);

        assert!(is_visible(&frame, &monitors));
        assert_eq!(fit(frame, &monitors), frame);
    }

    #[test]
    fn frame_partly_on_second_monitor_is_visible() {
        // 主屏 0..1920，第二块在左侧 -1680..0；窗口跨在两块屏交界处。
        let monitors = [
            monitor(0.0, 0.0, 1920.0, 1080.0),
            monitor(-1680.0, 0.0, 1680.0, 1050.0),
        ];
        let frame = Rect::new(-100.0, 200.0, 300.0, 200.0);

        assert!(is_visible(&frame, &monitors));
        assert_eq!(fit(frame, &monitors), frame);
    }

    #[test]
    fn frame_off_all_monitors_moves_into_first() {
        // 外接屏消失：保存位置只剩负坐标，当前只有一块主屏。
        let monitors = [monitor(0.0, 0.0, 1920.0, 1080.0)];
        let frame = Rect::new(-1680.0, 200.0, 300.0, 200.0);

        assert!(!is_visible(&frame, &monitors));
        let fitted = fit(frame, &monitors);
        assert!(is_visible(&fitted, &monitors));
        assert_eq!(fitted, Rect::new(0.0, 200.0, 300.0, 200.0));
    }

    #[test]
    fn at_least_raises_only_the_size() {
        let tiny = Rect::new(30.0, 40.0, 40.0, 30.0);

        assert_eq!(at_least(tiny, 200.0, 120.0), Rect::new(30.0, 40.0, 200.0, 120.0));
        // 已经够大就原样返回，位置和尺寸都不动
        assert_eq!(at_least(tiny, 20.0, 10.0), Rect::new(30.0, 40.0, 40.0, 30.0));
    }

    #[test]
    fn frame_past_bottom_right_edge_moves_into_work_area() {
        let monitors = [monitor(0.0, 0.0, 1920.0, 1080.0)];
        let frame = Rect::new(2000.0, 1000.0, 300.0, 200.0);

        assert!(!is_visible(&frame, &monitors));

        let fitted = fit(frame, &monitors);
        assert_eq!(fitted, Rect::new(1620.0, 880.0, 300.0, 200.0));
    }

    #[test]
    fn frame_larger_than_monitor_lands_at_origin() {
        let monitors = [monitor(0.0, 0.0, 200.0, 150.0)];
        let frame = Rect::new(-500.0, -500.0, 300.0, 200.0);

        assert_eq!(fit(frame, &monitors), Rect::new(0.0, 0.0, 300.0, 200.0));
    }

    #[test]
    fn no_monitors_keeps_frame() {
        let frame = Rect::new(-1680.0, 200.0, 300.0, 200.0);

        assert!(!is_visible(&frame, &[]));
        assert_eq!(fit(frame, &[]), frame);
    }
}
