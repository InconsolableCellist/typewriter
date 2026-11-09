# Startup file for the paper terminal. Your own ~/.bashrc still runs, so aliases and PATH carry over, and then the
# prompt is reduced to something a typewriter can print. A prompt that redraws itself (\r, several lines, a title
# trap) has no meaning on paper: every redraw is struck again over what is already there.
[ -f ~/.bashrc ] && source ~/.bashrc
trap - DEBUG
unset PROMPT_COMMAND PS0
PS1='$ '
PS2='> '
