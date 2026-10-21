//! 构建指纹注入：托盘菜单要回答「我手上跑的是哪一次构建」，
//! 光靠 Cargo.toml 的版本号不够——同一版本会构建很多次。

use std::process::Command;

fn git(args: &[&str]) -> Option<Vec<u8>> {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| out.stdout)
}

/// 短哈希。工作区有未提交改动时加 `-dirty`，免得把草稿当成已提交的版本。
fn stamp() -> String {
    let hash = git(&["rev-parse", "--short", "HEAD"])
        .and_then(|out| String::from_utf8(out).ok())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    let Some(hash) = hash else {
        return "nogit".into();
    };
    let dirty = git(&["status", "--porcelain"]).is_some_and(|out| !out.is_empty());
    if dirty {
        format!("{hash}-dirty")
    } else {
        hash
    }
}

/// 构建日期，精度到天。`date` 只保证在 unix 上有，其他平台退化成 unknown。
fn build_date() -> String {
    if !cfg!(unix) {
        return "unknown".into();
    }
    Command::new("date")
        .arg("+%Y-%m-%d")
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

fn main() {
    println!("cargo:rustc-env=BUILD_STAMP={}", stamp());
    println!("cargo:rustc-env=BUILD_DATE={}", build_date());
    // 文件或 git 状态一变就要重算，否则菜单会一直显示上一次的指纹。
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    // 前端与 package.json 也是构建输入：只改它们时 dirty 状态同样要刷新。
    println!("cargo:rerun-if-changed=../src");
    println!("cargo:rerun-if-changed=../index.html");
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
