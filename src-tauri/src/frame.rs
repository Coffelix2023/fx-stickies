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

/// 窗口对齐到屏幕可见区域的哪个位置。取值与前端 `PLACEMENTS` 一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Placement {
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    Center,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

/// 对齐时离屏幕边缘留的缝。贴死边会把便签的圆角和投影切掉。
const ALIGN_GAP: f64 = 12.0;

/// 把 frame 贴到 area 的某个位置，尺寸不动。
/// 窗口比可见区域还大时上下界会颠倒，和 `fit` 一样兜到区域左上角。
pub fn align(frame: Rect, area: Rect, placement: Placement) -> Rect {
    let x = match placement {
        Placement::TopLeft | Placement::MiddleLeft | Placement::BottomLeft => area.x + ALIGN_GAP,
        Placement::TopCenter | Placement::Center | Placement::BottomCenter => {
            area.x + (area.width - frame.width) / 2.0
        }
        Placement::TopRight | Placement::MiddleRight | Placement::BottomRight => {
            area.right() - frame.width - ALIGN_GAP
        }
    };
    let y = match placement {
        Placement::TopLeft | Placement::TopCenter | Placement::TopRight => area.y + ALIGN_GAP,
        Placement::MiddleLeft | Placement::Center | Placement::MiddleRight => {
            area.y + (area.height - frame.height) / 2.0
        }
        Placement::BottomLeft | Placement::BottomCenter | Placement::BottomRight => {
            area.bottom() - frame.height - ALIGN_GAP
        }
    };
    Rect {
        x: x.max(area.x),
        y: y.max(area.y),
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

    /// 主屏的可见工作区：起点 (0, 25)，右边缘 1920，下边缘 1080。
    fn work_area() -> Rect {
        monitor(0.0, 25.0, 1920.0, 1055.0)
    }

    #[test]
    fn align_corners_sit_a_gap_inside_the_work_area() {
        let frame = Rect::new(500.0, 400.0, 300.0, 200.0);

        assert_eq!(
            align(frame, work_area(), Placement::TopLeft),
            Rect::new(12.0, 37.0, 300.0, 200.0)
        );
        assert_eq!(
            align(frame, work_area(), Placement::TopRight),
            Rect::new(1608.0, 37.0, 300.0, 200.0)
        );
        assert_eq!(
            align(frame, work_area(), Placement::BottomLeft),
            Rect::new(12.0, 868.0, 300.0, 200.0)
        );
        assert_eq!(
            align(frame, work_area(), Placement::BottomRight),
            Rect::new(1608.0, 868.0, 300.0, 200.0)
        );
    }

    #[test]
    fn align_edges_keep_the_other_axis_and_center_splits_the_difference() {
        let frame = Rect::new(500.0, 400.0, 300.0, 200.0);
        let area = work_area();

        // 靠顶/靠底边：水平居中，纵向贴边
        assert_eq!(
            align(frame, area, Placement::TopCenter),
            Rect::new(810.0, 37.0, 300.0, 200.0)
        );
        assert_eq!(
            align(frame, area, Placement::BottomCenter),
            Rect::new(810.0, 868.0, 300.0, 200.0)
        );
        // 靠左/靠右边：纵向居中，横向贴边
        assert_eq!(
            align(frame, area, Placement::MiddleLeft),
            Rect::new(12.0, 452.5, 300.0, 200.0)
        );
        assert_eq!(
            align(frame, area, Placement::MiddleRight),
            Rect::new(1608.0, 452.5, 300.0, 200.0)
        );
        // 居中：两个方向都不留缝
        assert_eq!(
            align(frame, area, Placement::Center),
            Rect::new(810.0, 452.5, 300.0, 200.0)
        );
    }

    #[test]
    fn align_window_larger_than_the_work_area_lands_at_its_origin() {
        let frame = Rect::new(0.0, 0.0, 300.0, 200.0);

        assert_eq!(
            align(
                frame,
                monitor(0.0, 25.0, 200.0, 150.0),
                Placement::BottomRight
            ),
            Rect::new(0.0, 25.0, 300.0, 200.0)
        );
    }

    #[test]
    fn align_keeps_the_window_size() {
        let frame = Rect::new(500.0, 400.0, 300.0, 200.0);

        let aligned = align(frame, work_area(), Placement::Center);
        assert_eq!(aligned.width, frame.width);
        assert_eq!(aligned.height, frame.height);
    }

    #[test]
    fn no_monitors_keeps_frame() {
        let frame = Rect::new(-1680.0, 200.0, 300.0, 200.0);

        assert!(!is_visible(&frame, &[]));
        assert_eq!(fit(frame, &[]), frame);
    }
}
