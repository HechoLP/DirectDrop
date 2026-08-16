fn main() {
    if let Err(error) = directdrop_lib::run() {
        eprintln!("DirectDrop runtime error: {error}");
        std::process::exit(1);
    }
}
