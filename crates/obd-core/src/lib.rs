//! # obd-core
//!
//! Platform-independent core of EasyOBD:
//!
//! * [`transport`] – byte pipes to an ELM327 adapter (Wi-Fi/TCP, USB/Bluetooth serial, simulator)
//! * [`detect`]    – adapter discovery: USB, Bluetooth Classic, Bluetooth LE, Wi-Fi, chip identification
//! * [`elm327`]    – ELM327 command session (init, OBD-II requests, response framing)
//! * [`dtc`]       – Diagnostic Trouble Code decoding (modes 03 / 07 / 0A)
//! * [`pids`]      – Mode 01 live-data PIDs
//! * [`vin`]       – VIN reading and basic decoding
//! * [`uds`]       – expert mode: ECU scan, identification, UDS codes, guarded writes (ISO 14229)
//! * [`knowledge`] – repair knowledge base: explanations, 3D components, fixes, parts, cost, time, skill
//! * [`simulator`] – a virtual car with an ELM327, used for demos, training and tests
//! * [`specs`]     – vehicle technical sheet (capacities, fluids, torques) and cheaper valid alternatives
//! * [`inspection`] – technical inspection preparation (checklist, VIN locations, OBD pre-check)
//! * [`maintenance`] – illustrated maintenance tutorials and vehicle-specific shopping lists
//! * [`symptoms`]  – "diagnostic à l'œil" questionnaire (no scan tool needed)
//! * [`audio`]     – offline engine-sound analysis (RPM, misfire, squeal, whistle, ticking)

pub mod api;
pub mod audio;
#[cfg(feature = "ble")]
pub mod ble;
pub mod detect;
pub mod dtc;
pub mod elm327;
pub mod inspection;
pub mod j1939;
pub mod knowledge;
pub mod maintenance;
pub mod pids;
pub mod raw;
pub mod simulator;
pub mod specs;
pub mod symptoms;
pub mod training;
pub mod transport;
pub mod uds;
pub mod vin;

pub use dtc::{Dtc, DtcKind};
pub use elm327::{AdapterInfo, Elm327};
pub use knowledge::{Diagnosis, KnowledgeBase};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("erreur d'entrée/sortie : {0}")]
    Io(#[from] std::io::Error),
    #[error("délai dépassé en attendant la réponse de l'adaptateur")]
    Timeout,
    #[error("l'adaptateur n'arrive pas à communiquer avec le véhicule (contact mis ?)")]
    UnableToConnect,
    #[error("réponse inattendue de l'adaptateur : {0}")]
    Protocol(String),
    #[error("non connecté")]
    NotConnected,
    #[error("base de connaissances invalide : {0}")]
    KnowledgeBase(String),
}

pub type Result<T> = std::result::Result<T, Error>;
