mod binding;
mod generated;
mod js_value;
mod range;

pub use binding::Binding;
pub use generated::*;
pub use js_value::JsValue;
pub use range::SourceRange;

#[cfg(test)]
mod tests {
    use super::*;
    use insta::{assert_snapshot, glob};
    use serde_json;

    #[test]
    fn fixtures() {
        glob!("fixtures/**.json", |path| {
            let input = std::fs::read_to_string(path).unwrap();
            let ast: Program = serde_json::from_str(&input).unwrap();
            let serialized = serde_json::to_string_pretty(&ast).unwrap();
            assert_snapshot!(format!("Input:\n{input}\n\nOutput:\n{serialized}"));
        });
    }
}
