const { useState, useEffect, useMemo } = React;

const App = () => {
    const [totalDuration, setTotalDuration] = useState(600);
    const [numBrands, setNumBrands] = useState(3);
    
    // Initial state matching previous defaults
    const [brands, setBrands] = useState([
        {
            id: 'b1', name: 'Brand 1', budgetPct: 33.33, numVariations: 2,
            variations: [
                { id: 'v1-1', duration: 30, weightPct: 50 },
                { id: 'v1-2', duration: 30, weightPct: 50 }
            ]
        },
        {
            id: 'b2', name: 'Brand 2', budgetPct: 33.33, numVariations: 2,
            variations: [
                { id: 'v2-1', duration: 30, weightPct: 50 },
                { id: 'v2-2', duration: 30, weightPct: 50 }
            ]
        },
        {
            id: 'b3', name: 'Brand 3', budgetPct: 33.34, numVariations: 2,
            variations: [
                { id: 'v3-1', duration: 30, weightPct: 50 },
                { id: 'v3-2', duration: 30, weightPct: 50 }
            ]
        }
    ]);

    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [roundedOverrides, setRoundedOverrides] = useState({});

    const generateId = () => Math.random().toString(36).substr(2, 9);

    // When numBrands changes, adjust the brands array
    const handleNumBrandsChange = (val) => {
        const num = parseInt(val) || 0;
        setNumBrands(num);
        
        setBrands(prev => {
            let newBrands = [...prev];
            if (num > newBrands.length) {
                // Add brands
                const addCount = num - newBrands.length;
                for (let i = 0; i < addCount; i++) {
                    newBrands.push({
                        id: generateId(),
                        name: `Brand ${newBrands.length + 1}`,
                        budgetPct: 0,
                        numVariations: 1,
                        variations: [{ id: generateId(), duration: 15, weightPct: 100 }]
                    });
                }
            } else if (num < newBrands.length) {
                // Remove brands
                newBrands = newBrands.slice(0, num);
            }
            
            // Distribute budget equally
            if (num > 0) {
                const equalPct = Number((100 / num).toFixed(2));
                newBrands = newBrands.map((b, idx) => {
                    // Ensure last one rounds exactly to 100
                    if (idx === num - 1) {
                        const sumOthers = equalPct * (num - 1);
                        return { ...b, budgetPct: Number((100 - sumOthers).toFixed(2)) };
                    }
                    return { ...b, budgetPct: equalPct };
                });
            }
            
            return newBrands;
        });
        setResults(null);
    };

    const updateBrand = (id, field, value) => {
        setBrands(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
        setResults(null);
    };

    const handleNumVariationsChange = (brandId, val) => {
        const num = parseInt(val) || 0;
        
        setBrands(prev => prev.map(b => {
            if (b.id !== brandId) return b;
            
            let newVars = [...b.variations];
            if (num > newVars.length) {
                const addCount = num - newVars.length;
                for (let i = 0; i < addCount; i++) {
                    newVars.push({ id: generateId(), duration: 15, weightPct: 0 });
                }
            } else if (num < newVars.length) {
                newVars = newVars.slice(0, num);
            }
            
            // Distribute weight equally
            if (num > 0) {
                const equalPct = Number((100 / num).toFixed(2));
                newVars = newVars.map((v, idx) => {
                    if (idx === num - 1) {
                        const sumOthers = equalPct * (num - 1);
                        return { ...v, weightPct: Number((100 - sumOthers).toFixed(2)) };
                    }
                    return { ...v, weightPct: equalPct };
                });
            }
            
            return { ...b, numVariations: num, variations: newVars };
        }));
        setResults(null);
    };

    const updateVariation = (brandId, varId, field, value) => {
        setBrands(prev => prev.map(b => {
            if (b.id !== brandId) return b;
            return {
                ...b,
                variations: b.variations.map(v => v.id === varId ? { ...v, [field]: Number(value) } : v)
            };
        }));
        setResults(null);
    };

    // Flatten data for the bottom table preview and backend payload
    const flatRows = useMemo(() => {
        let rows = [];
        brands.forEach(b => {
            b.variations.forEach((v, idx) => {
                rows.push({
                    rowId: v.id,
                    brandId: b.id,
                    brand: b.name,
                    budgetPct: b.budgetPct,
                    duration: v.duration,
                    weightPct: v.weightPct,
                    isFirst: idx === 0,
                    rowSpan: b.variations.length
                });
            });
        });
        return rows;
    }, [brands]);

    const handleOptimize = async () => {
        setLoading(true);
        setError(null);
        
        const payloadBrands = brands.map(b => ({
            name: b.name,
            budget_pct: b.budgetPct,
            commercials: b.variations.map(v => ({
                rowId: v.id,
                duration: v.duration,
                weight_pct: v.weightPct
            }))
        }));

        try {
            const response = await fetch('/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ total_duration: totalDuration, brands: payloadBrands }),
            });

            const data = await response.json();
            
            if (response.ok) {
                const resultMapping = {};
                let resultIdx = 0;
                payloadBrands.forEach(b => {
                    b.commercials.forEach(c => {
                        resultMapping[c.rowId] = data.results[resultIdx];
                        resultIdx++;
                    });
                });
                
                setResults({
                    total_actual_duration: data.total_actual_duration,
                    mapping: resultMapping
                });
                setRoundedOverrides({});
            } else {
                setError(data.error || 'Failed to optimize');
            }
        } catch (err) {
            setError('Error connecting to server.');
        } finally {
            setLoading(false);
        }
    };

    // 1. Initial Largest Remainder Method per brand + 2. Duration Balancing
    // Balances total rounded duration to match target duration (allowing up to 10s excess)
    const autoBalancedMap = useMemo(() => {
        if (!results) return {};
        const map = {};

        // 1. Initial Largest Remainder Method per brand
        brands.forEach(b => {
            const varIds = b.variations.map(v => v.id);
            const spotValues = varIds.map(id => results.mapping[id]?.spots ?? 0);
            const exactSum = spotValues.reduce((s, x) => s + x, 0);
            const target = Math.round(exactSum);

            const floored = spotValues.map(x => Math.floor(x));
            const remainders = spotValues.map((x, i) => ({ idx: i, rem: x - floored[i] }));
            let flooredSum = floored.reduce((s, x) => s + x, 0);
            let deficit = target - flooredSum;

            remainders.sort((a, b) => b.rem - a.rem);
            remainders.forEach((r, rank) => {
                floored[r.idx] += rank < deficit ? 1 : 0;
            });

            varIds.forEach((id, i) => { map[id] = floored[i]; });
        });

        const targetDur = results.total_actual_duration || Number(totalDuration) || 0;
        const MAX_EXCESS = 10; // Up to 10 seconds excess allowed

        // Compute current rounded duration
        let currentDur = flatRows.reduce((sum, r) => sum + (map[r.rowId] || 0) * (Number(r.duration) || 0), 0);

        // If greater than Total Optimized Duration + 10s: reduce spots from greatest possible place
        let safetyCounter = 0;
        while (currentDur > targetDur + MAX_EXCESS && safetyCounter < 100) {
            safetyCounter++;
            const eligible = flatRows.filter(r => (map[r.rowId] || 0) > 0);
            if (eligible.length === 0) break;

            eligible.sort((a, b) => {
                const countA = map[a.rowId] || 0;
                const countB = map[b.rowId] || 0;
                if (countB !== countA) return countB - countA; // Greatest spot count first

                const exactA = results.mapping[a.rowId]?.spots || 0;
                const exactB = results.mapping[b.rowId]?.spots || 0;
                const overA = countA - exactA;
                const overB = countB - exactB;
                if (overB !== overA) return overB - overA; // Highest over-allocation next

                return (Number(b.duration) || 0) - (Number(a.duration) || 0);
            });

            const chosen = eligible[0];
            map[chosen.rowId] -= 1;
            currentDur -= (Number(chosen.duration) || 0);
        }

        // If less than Total Optimized Duration: add anywhere that can fit into available duration
        safetyCounter = 0;
        while (currentDur < targetDur && safetyCounter < 100) {
            safetyCounter++;
            const maxAllowed = targetDur + MAX_EXCESS;
            const remaining = maxAllowed - currentDur;

            // Only consider variations whose duration fits within the remaining allowed budget
            const eligible = flatRows.filter(r => (Number(r.duration) || 0) <= remaining);
            if (eligible.length === 0) break;

            eligible.sort((a, b) => {
                const countA = map[a.rowId] || 0;
                const countB = map[b.rowId] || 0;
                const exactA = results.mapping[a.rowId]?.spots || 0;
                const exactB = results.mapping[b.rowId]?.spots || 0;
                const underA = exactA - countA;
                const underB = exactB - countB;
                if (underB !== underA) return underB - underA; // Most under-allocated first

                return (Number(b.duration) || 0) - (Number(a.duration) || 0);
            });

            const chosen = eligible[0];
            map[chosen.rowId] += 1;
            currentDur += (Number(chosen.duration) || 0);
        }

        return map;
    }, [results, brands, flatRows, totalDuration]);

    // Active rounded spots map (combines auto-balance with user adjustments)
    const roundedSpotsMap = useMemo(() => {
        const finalMap = { ...autoBalancedMap };
        Object.keys(roundedOverrides).forEach(key => {
            if (roundedOverrides[key] !== undefined) {
                finalMap[key] = roundedOverrides[key];
            }
        });
        return finalMap;
    }, [autoBalancedMap, roundedOverrides]);

    // Manually tweak rounded spots for a variation
    const adjustSpot = (rowId, delta) => {
        setRoundedOverrides(prev => {
            const current = roundedSpotsMap[rowId] ?? 0;
            const nextVal = Math.max(0, current + delta);
            return { ...prev, [rowId]: nextVal };
        });
    };

    // Reset all manual overrides back to algorithmically balanced spots
    const handleResetToAutoBalance = () => {
        setRoundedOverrides({});
    };

    // Calculate totals for spots and durations (sum product of duration and spots)
    const totals = useMemo(() => {
        if (!results) return null;
        let optSpots = 0;
        let roundSpots = 0;
        let optDur = 0;
        let roundDur = 0;

        flatRows.forEach(row => {
            const res = results.mapping[row.rowId];
            const rSpots = roundedSpotsMap[row.rowId] ?? 0;
            const dur = Number(row.duration) || 0;

            if (res) {
                optSpots += res.spots || 0;
                optDur += (res.spots || 0) * dur;
            }
            roundSpots += rSpots;
            roundDur += rSpots * dur;
        });

        const diff = Number((roundDur - optDur).toFixed(2));

        return {
            optimizedSpots: optSpots,
            roundedSpots: roundSpots,
            optimizedDuration: optDur,
            roundedDuration: roundDur,
            actualDuration: optDur,
            durationDiff: diff,
            isBalanced: diff <= 10 && diff >= -10
        };
    }, [results, flatRows, roundedSpotsMap]);

    return (
        <div>
            <header className="app-header">
                <div className="header-left">
                    <i>Where Intelligence Shapes Smarter Media Planning.</i>
                </div>
                <div className="header-center">
                    <img src="/company-logo.png" alt="Media Factory" style={{ height: '45px', objectFit: 'contain' }} />
                    <span className="company-name" style={{ marginLeft: '10px' }}>Media Factory (PVT) LTD</span>
                </div>
                <div className="header-right">
                    <span className="badge">Spot Allocation Optimizer</span>
                    <span className="badge">2026</span>
                </div>
            </header>

            <div className="app-container">
            {error && <div className="error-alert">{error}</div>}

            <div className="main-grid" style={{ gridTemplateColumns: '1fr', gap: '2rem' }}>
                
                {/* 1. Brands Setup Table */}
                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{color: 'var(--text-primary)', margin: 0}}>1. Brand Budgets Setup</h3>
                        <div className="input-group">
                            <label>Number of Brands:</label>
                            <input 
                                type="number" 
                                min="0"
                                value={numBrands} 
                                onChange={(e) => handleNumBrandsChange(e.target.value)}
                                style={{ width: '80px', textAlign: 'center' }}
                            />
                        </div>
                    </div>
                    
                    {brands.length > 0 && (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{width: '60%'}}>Brand Name</th>
                                        <th style={{width: '40%'}}>Budget Allocation (%)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {brands.map((b, idx) => (
                                        <tr key={b.id} className={`brand-group-${idx % 5}`}>
                                            <td>
                                                <input 
                                                    className="table-input" 
                                                    type="text" 
                                                    value={b.name} 
                                                    onChange={(e) => updateBrand(b.id, 'name', e.target.value)}
                                                />
                                            </td>
                                            <td>
                                                <input 
                                                    className="table-input" 
                                                    type="number" 
                                                    value={b.budgetPct} 
                                                    onChange={(e) => updateBrand(b.id, 'budgetPct', Number(e.target.value))}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* 2. Variations Setup */}
                <div className="card">
                    <h3 style={{color: 'var(--text-primary)', margin: '0 0 1.5rem 0'}}>2. Duration Variations & Weights</h3>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {brands.map((b, idx) => (
                            <div key={b.id} style={{ background: '#f8fafc', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', borderLeft: `4px solid var(--brand-color-${idx % 5})` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                                    <strong style={{color: 'var(--text-primary)'}}>{b.name}</strong>
                                    <div className="input-group" style={{gap: '0.5rem'}}>
                                        <label style={{fontSize: '0.7rem'}}>Variations:</label>
                                        <input 
                                            type="number" 
                                            min="0"
                                            value={b.numVariations} 
                                            onChange={(e) => handleNumVariationsChange(b.id, e.target.value)}
                                            style={{ width: '60px', padding: '0.25rem', fontSize: '0.85rem' }}
                                        />
                                    </div>
                                </div>

                                {/* Column headers */}
                                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.25rem', paddingBottom: '0.25rem' }}>
                                    <div style={{ flex: 1, fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duration (s)</div>
                                    <div style={{ flex: 1, fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Weight (%)</div>
                                </div>

                                {b.variations.map((v, vIdx) => (
                                    <div key={v.id} style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                                        <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
                                            <input 
                                                className="table-input"
                                                type="number" 
                                                placeholder="Duration (s)"
                                                value={v.duration} 
                                                onChange={(e) => updateVariation(b.id, v.id, 'duration', e.target.value)}
                                            />
                                        </div>
                                        <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
                                            <input 
                                                className="table-input"
                                                type="number" 
                                                placeholder="Weight (%)"
                                                value={v.weightPct} 
                                                onChange={(e) => updateVariation(b.id, v.id, 'weightPct', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 3. Final Preview & Optimization Table */}
                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <h3 style={{color: 'var(--text-primary)', margin: 0}}>3. Final Preview & Calculation</h3>
                            {results && totals && (
                                totals.durationDiff > 10 ? (
                                    <span className="balance-badge balance-badge-danger">
                                        ⚠ Exceeds Target by +{totals.durationDiff.toFixed(1)}s (Max +10s allowed)
                                    </span>
                                ) : totals.durationDiff < 0 ? (
                                    <span className="balance-badge balance-badge-warning">
                                        ℹ Under Target by {Math.abs(totals.durationDiff).toFixed(1)}s
                                    </span>
                                ) : (
                                    <span className="balance-badge balance-badge-success">
                                        ✓ Duration Balanced ({totals.durationDiff >= 0 ? `+${totals.durationDiff.toFixed(1)}s` : `${totals.durationDiff.toFixed(1)}s`})
                                    </span>
                                )
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                            <div className="input-group">
                                <label>Total Available Duration (s):</label>
                                <input 
                                    type="number" 
                                    value={totalDuration} 
                                    onChange={(e) => { setTotalDuration(Number(e.target.value)); setResults(null); }}
                                    style={{ width: '120px', fontWeight: 'bold' }}
                                />
                            </div>
                            <button 
                                className="btn btn-primary" 
                                onClick={handleOptimize}
                                disabled={loading || flatRows.length === 0}
                                style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}
                            >
                                {loading ? 'Optimizing...' : 'Calculate Optimization'}
                            </button>
                        </div>
                    </div>

                    <div className="data-table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Program / Brand</th>
                                    <th>Budget %</th>
                                    <th>Cut Dur. (s)</th>
                                    <th>Weight %</th>
                                    <th style={{color: 'var(--accent-primary)'}}>Optimized Spots</th>
                                    <th style={{color: 'var(--success)'}}>Rounded Spots</th>
                                    <th style={{color: 'var(--accent-primary)'}}>Actual Dur.</th>
                                    <th style={{color: 'var(--accent-primary)'}}>Brand Total Dur.</th>
                                </tr>
                            </thead>
                            <tbody>
                                {flatRows.map((row) => {
                                    const res = results?.mapping[row.rowId];
                                    const brandIndex = brands.findIndex(b => b.id === row.brandId);
                                    
                                    // Calculate brand total if results exist
                                    let brandTotal = 0;
                                    if (results) {
                                        Object.values(results.mapping).forEach(r => {
                                            if (r.brand === row.brand) brandTotal += r.actual_duration;
                                        });
                                    }
                                    
                                    return (
                                        <tr key={row.rowId} className={`brand-group-${brandIndex % 5}`}>
                                            <td style={{color: 'var(--text-primary)', fontWeight: 500}}>{row.brand}</td>
                                            <td>{row.budgetPct}%</td>
                                            <td>{row.duration}s</td>
                                            <td>{row.weightPct}%</td>
                                            <td className="result-val highlight-val">
                                                {res ? res.spots.toFixed(2) : '-'}
                                            </td>
                                            <td className="result-val" style={{ color: 'var(--success)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                {results ? (
                                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <button 
                                                            type="button" 
                                                            className="spot-adjust-btn" 
                                                            onClick={() => adjustSpot(row.rowId, -1)}
                                                            disabled={(roundedSpotsMap[row.rowId] || 0) <= 0}
                                                            title="Decrease 1 spot"
                                                        >−</button>
                                                        <span style={{ minWidth: '20px', textAlign: 'center' }}>
                                                            {roundedSpotsMap[row.rowId] !== undefined ? roundedSpotsMap[row.rowId] : '-'}
                                                        </span>
                                                        <button 
                                                            type="button" 
                                                            className="spot-adjust-btn" 
                                                            onClick={() => adjustSpot(row.rowId, 1)}
                                                            title="Increase 1 spot"
                                                        >+</button>
                                                    </div>
                                                ) : '-'}
                                            </td>
                                            <td className="result-val">
                                                {res ? res.actual_duration.toFixed(2) : '-'}
                                            </td>
                                            {row.isFirst && (
                                                <td rowSpan={row.rowSpan} className="result-val highlight-val" style={{ opacity: 0.8, verticalAlign: 'middle', borderLeft: '1px solid var(--border-color)', backgroundColor: 'rgba(255, 255, 255, 0.4)' }}>
                                                    {res ? (
                                                        <>
                                                            {brandTotal.toFixed(2)}
                                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '4px' }}>
                                                                / {totalDuration > 0 ? ((brandTotal / totalDuration) * 100).toFixed(1) : 0}%
                                                            </span>
                                                        </>
                                                    ) : '-'}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {flatRows.length > 0 && (
                                <tfoot>
                                    <tr className="table-total-row">
                                        <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, letterSpacing: '0.05em' }}>
                                            Total:
                                        </td>
                                        <td className="result-val highlight-val" style={{ fontWeight: 800 }}>
                                            <div>{totals ? totals.optimizedSpots.toFixed(2) : '-'}</div>
                                            {totals && (
                                                <div style={{ fontSize: '0.78rem', color: 'var(--accent-primary)', fontWeight: 600, marginTop: '2px' }}>
                                                    {totals.optimizedDuration.toFixed(2)}s
                                                </div>
                                            )}
                                        </td>
                                        <td className="result-val" style={{ color: 'var(--success)', fontWeight: 800 }}>
                                            <div>{totals ? totals.roundedSpots : '-'}</div>
                                            {totals && (
                                                <div style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: 600, marginTop: '2px' }}>
                                                    {totals.roundedDuration.toFixed(2)}s
                                                </div>
                                            )}
                                        </td>
                                        <td className="result-val" style={{ fontWeight: 800 }}>
                                            {totals ? `${totals.optimizedDuration.toFixed(2)}s` : '-'}
                                        </td>
                                        <td className="result-val highlight-val" style={{ fontWeight: 800 }}>
                                            {totals ? (
                                                <>
                                                    {totals.optimizedDuration.toFixed(2)}s
                                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '4px' }}>
                                                        / {totalDuration > 0 ? ((totals.optimizedDuration / totalDuration) * 100).toFixed(1) : 0}%
                                                    </span>
                                                </>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                        {results && totals && (
                            <div className="summary-bar">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginRight: 'auto', flexWrap: 'wrap' }}>
                                    {totals.durationDiff > 10 ? (
                                        <span className="balance-badge balance-badge-danger">
                                            ⚠ Exceeds by +{totals.durationDiff.toFixed(1)}s (Max +10s allowed)
                                        </span>
                                    ) : totals.durationDiff < 0 ? (
                                        <span className="balance-badge balance-badge-warning">
                                            ℹ Under by {Math.abs(totals.durationDiff).toFixed(1)}s
                                        </span>
                                    ) : (
                                        <span className="balance-badge balance-badge-success">
                                            ✓ Duration Balanced ({totals.durationDiff >= 0 ? `+${totals.durationDiff.toFixed(1)}s` : `${totals.durationDiff.toFixed(1)}s`})
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        className="btn-sm btn-auto-balance"
                                        onClick={handleResetToAutoBalance}
                                        title="Automatically balance rounded spots to match target duration"
                                    >
                                        {Object.keys(roundedOverrides).length > 0 ? 'Reset to Auto-Balance' : 'Re-balance'}
                                    </button>
                                </div>

                                <div className="summary-stat">
                                    <span>Total Optimized Spots</span>
                                    <strong style={{ color: 'var(--accent-primary)' }}>{totals.optimizedSpots.toFixed(2)}</strong>
                                </div>
                                <div className="summary-stat">
                                    <span>Total Optimized Duration</span>
                                    <strong style={{ color: 'var(--accent-primary)' }}>
                                        {totals.optimizedDuration.toFixed(2)}s
                                        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '4px' }}>
                                            / {totalDuration}s
                                        </span>
                                    </strong>
                                </div>
                                <div className="summary-stat">
                                    <span>Total Rounded Spots</span>
                                    <strong style={{ color: 'var(--success)' }}>{totals.roundedSpots}</strong>
                                </div>
                                <div className="summary-stat">
                                    <span>Total Rounded Duration</span>
                                    <strong style={{ color: 'var(--success)' }}>
                                        {totals.roundedDuration.toFixed(2)}s
                                        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '4px' }}>
                                            / {totalDuration}s
                                        </span>
                                    </strong>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
            </div>

            <footer style={{
                textAlign: 'center',
                padding: '1.5rem',
                borderTop: '1px solid var(--border-color)',
                background: '#ffffff',
                color: 'var(--text-secondary)',
                fontSize: '0.85rem',
                marginTop: '2rem'
            }}>
                © 2026 Media Factory (PVT) LTD. All rights reserved.
            </footer>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
