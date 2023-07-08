use std::collections::HashSet;

use indexmap::IndexMap;
use quote::{__private::TokenStream, format_ident, quote};
use serde::{Deserialize, Serialize};

/// Returns prettyplease-formatted Rust source for estree
pub fn estree() -> String {
    let src = include_str!("./ecmascript.json");
    let grammar: Grammar = serde_json::from_str(src).unwrap();
    let raw = grammar.codegen().to_string();

    let parsed = syn::parse_file(&raw).unwrap();
    prettyplease::unparse(&parsed)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Grammar {
    pub objects: IndexMap<String, Object>,
    pub nodes: IndexMap<String, Node>,
    pub enums: IndexMap<String, Enum>,
    pub operators: IndexMap<String, Operator>,
}

impl Grammar {
    pub fn codegen(self) -> TokenStream {
        let Self {
            objects,
            nodes,
            enums,
            operators,
        } = self;

        let enum_names: HashSet<String> = enums.keys().cloned().collect();

        let mut node_names: Vec<_> = nodes.keys().cloned().collect();
        node_names.sort();

        let objects: Vec<_> = objects
            .iter()
            .map(|(name, object)| object.codegen(name))
            .collect();
        let nodes: Vec<_> = nodes
            .iter()
            .map(|(name, node)| node.codegen(name))
            .collect();
        let enums: Vec<_> = enums
            .iter()
            .map(|(name, enum_)| enum_.codegen(name, &enum_names))
            .collect();
        let operators: Vec<_> = operators
            .iter()
            .map(|(name, operator)| operator.codegen(name))
            .collect();

        quote! {
            use std::num::NonZeroU32;
            use serde::{Serialize, Deserialize};
            use crate::{JsValue, Binding, SourceRange};

            #(#objects)*

            #(#nodes)*

            #(#enums)*

            #(#operators)*
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Object {
    #[serde(default)]
    pub fields: IndexMap<String, Field>,
}

impl Object {
    pub fn codegen(&self, name: &str) -> TokenStream {
        let name = format_ident!("{}", name);
        let fields: Vec<_> = self
            .fields
            .iter()
            .map(|(name, field)| field.codegen(name))
            .collect();

        quote! {
            #[derive(Serialize, Deserialize, Clone, Debug)]
            pub struct #name {
                #(#fields),*
            }
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Node {
    #[serde(default)]
    pub fields: IndexMap<String, Field>,
}

impl Node {
    pub fn codegen(&self, name: &str) -> TokenStream {
        let name = format_ident!("{}", name);
        let fields: Vec<_> = self
            .fields
            .iter()
            .map(|(name, field)| field.codegen_node(name))
            .collect();

        quote! {
            #[derive(Serialize, Deserialize, Clone, Debug)]
            pub struct #name {
                #(#fields,)*

                #[serde(default)]
                pub loc: Option<SourceLocation>,

                #[serde(default)]
                pub range: Option<SourceRange>,
            }
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Field {
    #[serde(rename = "type")]
    pub type_: String,

    #[serde(default)]
    pub nullable: bool,

    #[serde(default)]
    pub optional: bool,

    #[serde(default)]
    pub plural: bool,

    #[serde(default)]
    pub nullable_item: bool,

    #[serde(default)]
    pub flatten: bool,

    #[serde(default)]
    pub rename: Option<String>,
}

impl Field {
    pub fn codegen(&self, name: &str) -> TokenStream {
        let name = format_ident!("{}", name);
        let type_name = format_ident!("{}", &self.type_);
        let mut type_ = quote!(#type_name);
        if self.plural {
            if self.nullable_item {
                type_ = quote!(Option<#type_>);
            }
            type_ = quote! { Vec<#type_> };
        } else {
            assert_eq!(
                self.nullable_item, false,
                "Can only set nullable_item if plural"
            )
        }
        if self.nullable {
            type_ = quote!(Option<#type_>);
        }
        let mut field = quote!(#name: #type_);
        if self.optional {
            field = quote! {
                #[serde(default)]
                #field
            }
        }
        if let Some(rename) = &self.rename {
            field = quote! {
                #[serde(rename = #rename)]
                #field
            }
        }
        if self.flatten {
            field = quote! {
                #[serde(flatten)]
                #field
            }
        }
        field
    }

    pub fn codegen_node(&self, name: &str) -> TokenStream {
        let name = format_ident!("{}", name);
        let type_name = format_ident!("{}", &self.type_);
        let mut type_ = quote!(#type_name);
        if self.plural {
            if self.nullable_item {
                type_ = quote!(Option<#type_>);
            }
            type_ = quote! { Vec<#type_> };
        } else {
            assert_eq!(
                self.nullable_item, false,
                "Can only set nullable_item if plural"
            )
        }
        if self.nullable {
            type_ = quote!(Option<#type_>);
        }
        let mut field = quote!(#name: #type_);
        if self.optional {
            field = quote! {
                #[serde(default)]
                #field
            }
        }
        if self.flatten {
            field = quote! {
                #[serde(flatten)]
                #field
            }
        }
        if let Some(rename) = &self.rename {
            field = quote! {
                #[serde(rename = #rename)]
                #field
            }
        }
        field
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(transparent)]
pub struct Enum {
    pub variants: Vec<String>,
}

impl Enum {
    pub fn codegen(&self, name: &str, enums: &HashSet<String>) -> TokenStream {
        let mut sorted_variants: Vec<_> = self.variants.iter().collect();
        sorted_variants.sort();

        let name = format_ident!("{}", name);
        let variants: Vec<_> = sorted_variants
            .iter()
            .map(|name| {
                let variant = format_ident!("{}", name);
                if enums.contains(*name) {
                    quote!(#variant(#variant))
                } else {
                    quote!(#variant(Box<#variant>))
                }
            })
            .collect();

        let enum_ = quote! {
            pub enum #name {
                #(#variants),*
            }
        };
        let enum_ = if sorted_variants.iter().any(|name| enums.contains(*name)) {
            // contains recursive enum, use untagged serialization
            quote! {
                #[serde(untagged)]
                #enum_
            }
        } else {
            quote! {
                #[serde(tag = "type")]
                #enum_
            }
        };

        quote! {
            #[derive(Serialize, Deserialize, Clone, Debug)]
            #enum_
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(transparent)]
pub struct Operator {
    pub variants: IndexMap<String, String>,
}

impl Operator {
    pub fn codegen(&self, name: &str) -> TokenStream {
        let mut sorted_variants: Vec<_> = self.variants.iter().collect();
        sorted_variants.sort();

        let name = format_ident!("{}", name);
        let variants: Vec<_> = sorted_variants
            .iter()
            .map(|(name, operator)| {
                let name = format_ident!("{}", name);
                let comment = format!(" {}", &operator);
                quote! {
                    #[doc = #comment]
                    #[serde(rename = #operator)]
                    #name
                }
            })
            .collect();

        let display_matches: Vec<_> = sorted_variants
            .iter()
            .map(|(name, operator)| {
                let name = format_ident!("{}", name);
                quote!(Self::#name => #operator)
            })
            .collect();

        let fromstr_matches: Vec<_> = sorted_variants
            .iter()
            .map(|(name, operator)| {
                let name = format_ident!("{}", name);
                quote!(#operator => Ok(Self::#name))
            })
            .collect();

        quote! {
            #[derive(Serialize, Deserialize, Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash, Debug)]
            pub enum #name {
                #(#variants),*
            }

            impl std::fmt::Display for #name {
                fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                    let name = match self {
                        #(#display_matches),*
                    };
                    f.write_str(name)
                }
            }

            impl std::str::FromStr for #name {
                type Err = ();

                fn from_str(s: &str) -> Result<Self, Self::Err> {
                    match s {
                        #(#fromstr_matches,)*
                        _ => Err(()),
                    }
                }
            }
        }
    }
}
