//! Fixture with a known inventory — used to validate inventory.py.

use std::collections::HashMap;
use std::fmt;

pub const PAGE_SIZE: usize = 50;
static CACHE_DIR: &str = "/tmp/widgets";

pub type WidgetId = String;

#[derive(Debug, Clone)]
pub struct Widget {
    pub name: String,
    size: i64,
}

#[derive(Debug)]
pub enum WidgetError {
    Missing(WidgetId),
    Invalid { reason: String },
}

pub trait Sizable {
    fn area(&self) -> i64;
    fn label(&self) -> String {
        String::from("widget {")
    }
}

impl Sizable for Widget {
    fn area(&self) -> i64 {
        self.size * self.size
    }
}

impl fmt::Display for Widget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name)
    }
}

#[cfg(feature = "fast")]
pub fn load_widget(id: &WidgetId) -> Result<Widget, WidgetError> {
    Ok(Widget { name: id.clone(), size: PAGE_SIZE as i64 })
}

fn build_cache() -> HashMap<WidgetId, Widget> {
    HashMap::new()
}

#[macro_export]
macro_rules! widget_of {
    ($name:expr) => {
        Widget { name: $name.to_string(), size: 1 }
    };
}

pub(crate) mod helpers {
    pub fn normalize(name: &str) -> String {
        name.trim().to_lowercase()
    }
}
