const create_tooltip = (parentEl) => {
    for (let i = 0; i < parentEl.children.length; i++) {
        $(parentEl.children[i]).css('pointer-events', 'none')
    }
    let text = parentEl.getAttribute('tooltip-text');
    let position = parentEl.getAttribute('tooltip-pos');
    $(parentEl).append(`<div class="el-tooltip ${position}">${text}</div>`)
};

const remove_tooltip = () => {
    $('.el-tooltip').fadeOut(200).remove();
};

export {create_tooltip, remove_tooltip};