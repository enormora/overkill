export const replacements = {
    replace<Target>(value: Target, active: boolean): Target | null {
        return active ? value : null;
    }
};
